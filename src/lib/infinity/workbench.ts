/**
 * Infinity — local voice commands for Workbench mode.
 * Matched client-side before anything is sent to the LLM.
 */

export type WorkbenchAction = "open" | "close";

const OPEN_RE = /\b(open|start|enter|show|enable|activate|launch|begin|turn on)\b/;
const CLOSE_RE = /\b(close|exit|leave|stop|end|disable|hide|quit|turn off)\b/;

/**
 * Returns "open" / "close" when the utterance looks like a workbench
 * command, otherwise null (→ treat as a normal conversation turn).
 * Only short utterances count, so everyday mentions of the word don't.
 */
export function matchWorkbenchCommand(input: string): WorkbenchAction | null {
  const t = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ");
  if (!t.includes("workbench")) return null;

  const words = t.split(" ").filter(Boolean);
  if (words.length > 6) return null;

  if (CLOSE_RE.test(t)) return "close";
  if (OPEN_RE.test(t)) return "open";
  // Bare "workbench" / "workbench mode" / "workbench please" → open.
  if (words.length <= 3) return "open";
  return null;
}

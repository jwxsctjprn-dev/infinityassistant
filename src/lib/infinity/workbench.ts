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

/* ------------------------------------------------------------------ */
/* Build / delete commands for workbench models                        */
/* ------------------------------------------------------------------ */

export interface BuildCommand {
  object: string;
}

const BUILD_VERB_RE = /\b(build|create|make|generate|construct|design|assemble)\b/;

/**
 * "build a model of a lighthouse" / "create a 3d model of a treehouse" /
 * "make me a castle model" → { object: "lighthouse" | ... }
 */
export function matchBuildCommand(input: string): BuildCommand | null {
  const t = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
  if (!/\bmodel\b/.test(t)) return null;
  if (!BUILD_VERB_RE.test(t)) return null;

  let object = "";
  let m = t.match(/\bmodel\s+of\s+(.+)$/);
  if (m) {
    object = m[1];
  } else {
    m = t.match(
      /\b(?:build|create|make|generate|construct|design|assemble)\s+(?:me\s+)?(?:a|an|the|some)?\s*(.+?)\s+model(?:\s+of\s+(.+))?$/
    );
    if (m) object = m[2] || m[1] || "";
  }
  if (!object) return null;

  object = object
    .replace(/\b(please|for me|now|quickly|holographic|hologram|3d)\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(a|an|the)\s+/, "")
    .trim();
  if (!object || object.split(" ").length > 6) return null;
  return { object };
}

export type DeleteCommand = { all: true } | { name: string };

/**
 * "delete the lighthouse" / "remove the tree house model" /
 * "clear the workbench" / "delete all models" → actionable command.
 */
export function matchDeleteCommand(input: string, modelNames: string[]): DeleteCommand | null {
  const t = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
  if (!t) return null;

  const clearAll =
    (/\b(clear|empty|wipe|reset)\b/.test(t) && /\bworkbench\b/.test(t)) ||
    (/\b(delete|remove)\b/.test(t) && /\b(all|everything)\b/.test(t) && /\bmodel|workbench\b/.test(t));
  if (clearAll) return { all: true };

  if (!/\b(delete|remove|destroy|get rid of)\b/.test(t)) return null;

  const norm = (s: string) => s.toLowerCase().replace(/s\b/g, "").replace(/\s+/g, " ").trim();
  const textWords = norm(t);
  for (const name of modelNames) {
    const words = norm(name).split(" ").filter((w) => w.length > 2);
    if (words.length > 0 && words.every((w) => textWords.includes(w))) {
      return { name };
    }
  }
  return null;
}

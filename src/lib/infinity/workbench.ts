/**
 * Infinity — local voice commands for Workbench mode.
 * Matched client-side before anything is sent to the LLM.
 */

export type WorkbenchAction = "open" | "close";

const OPEN_RE = /\b(open|start|enter|show|enable|activate|launch|begin|turn on)\b/;
const CLOSE_RE = /\b(close|exit|leave|stop|end|disable|hide|quit|turn off)\b/;

/** Question words — an utterance ASKING about things ("what's on the
 *  workbench?", "what did you build?") must reach the conversation LLM,
 *  which has live vision of the bench. Never let it trigger a command. */
const QUESTION_RE = /\b(what|whats|which|why|who|whose|where|how|describe|explain|tell)\b/;

/** Everything the user might call the workbench — all treated as one
 *  concept, so "open the workshop" / "clear the studio" / "what's on the
 *  lab" work exactly like the same sentence with "workbench". */
const BENCH_WORDS = "workbench|workshop|bench|studio|workspace|lab";
const BENCH_SYNONYM_RE = new RegExp(`\\b(${BENCH_WORDS})\\b`, "g");
const BENCH_TEST_RE = new RegExp(`\\b(${BENCH_WORDS})\\b`);

/** True when the (normalized) utterance mentions the bench by any name. */
export function mentionsBench(normalized: string): boolean {
  return BENCH_TEST_RE.test(normalized);
}

/** Command matching maps every bench synonym to "workbench". */
function benchify(normalized: string): string {
  return normalized.replace(BENCH_SYNONYM_RE, "workbench");
}

/** Normalized lowercase word stream for the matchers below. */
function normalizeUtterance(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Returns "open" / "close" when the utterance looks like a workbench
 * command, otherwise null (→ treat as a normal conversation turn).
 * Only short utterances count, so everyday mentions of the word don't.
 */
export function matchWorkbenchCommand(input: string): WorkbenchAction | null {
  const t = benchify(
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z\s]/g, "")
      .replace(/\s+/g, " ")
  );
  if (QUESTION_RE.test(t)) return null; // "show me what's on the workshop" → chat
  if (!t.includes("workbench")) return null;

  const words = t.split(" ").filter(Boolean);
  if (words.length > 6) return null;

  // "clear/delete the workbench" is a DELETE command, not an open/close —
  // return null so matchDeleteCommand handles it (tryWorkbench runs first).
  if (/\b(delete|remove|destroy|clear|wipe|empty|reset)\b/.test(t)) return null;

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
  /** True when the user explicitly asked the AI to invent it ("design a…" /
   *  "invent a…") — skips the local builders when a key is configured. */
  forceDesign?: boolean;
}

const BUILD_VERB_RE = /\b(build|create|make|generate|construct|design|assemble|invent)\b/;
const BUILD_VERB_FIRST_RE = /^(?:build|create|make|generate|construct|design|assemble|invent)\b/;
const FORCE_DESIGN_RE = /\b(design|invent)\b/;

/** Words that mean the user wants to EDIT/tweak, not build something new. */
const NON_BUILD_WORDS = new Set([
  "it", "this", "that", "them", "bigger", "smaller", "larger", "taller", "shorter",
  "brighter", "darker", "faster", "slower", "spin", "spinning", "rotate", "turn",
  "move", "shift", "delete", "remove", "clear", "destroy", "workbench", "model",
]);

/** Color words — legitimate inside an object ("red telephone") but a recolor
 * request when they come LAST ("make the chair red"). */
const COLOR_WORDS = new Set([
  "red", "blue", "green", "yellow", "purple", "orange", "white", "black", "pink",
  "gray", "grey", "brown", "gold", "silver", "cyan", "magenta",
]);

/**
 * "build a model of a lighthouse" / "create a 3d model of a treehouse" /
 * "make me a castle model" / "make me a vintage red telephone" →
 * { object: "lighthouse" | ... }
 *
 * Inside the workbench, the word "model" is optional. Outside it, the
 * utterance must START with a build verb (so normal conversation is never
 * hijacked, but "make me a rocket ship" always works).
 */
export function matchBuildCommand(input: string, inWorkbench = false): BuildCommand | null {
  const t = normalizeUtterance(input);
  if (QUESTION_RE.test(t)) return null; // "what did you make for me?" → chat

  let object = "";

  if (/\bmodel\b/.test(t) && BUILD_VERB_RE.test(t)) {
    let m = t.match(/\bmodel\s+of\s+(.+)$/);
    if (m) {
      object = m[1];
    } else {
      m = t.match(
        /\b(?:build|create|make|generate|construct|design|assemble|invent)\s+(?:me\s+)?(.+?)\s+model(?:\s+of\s+(.+))?$/
      );
      if (m) object = m[2] || m[1] || "";
    }
  } else if (
    BUILD_VERB_RE.test(t) &&
    (inWorkbench || BUILD_VERB_FIRST_RE.test(t)) &&
    t.split(" ").length <= 8 &&
    !/\b(workbench|delete|remove|clear)\b/.test(t)
  ) {
    // "build a cube" / "make me a vintage red telephone" / "design a dragon"
    // (articles are stripped AFTER — an inline (?:a|an)? group would eat
    // just the "a" of "an accordion" and leave "n accordion")
    const m = t.match(
      /\b(?:build|create|make|generate|construct|design|assemble|invent)\s+(?:me\s+)?(.+)$/
    );
    if (m) object = m[1] || "";
    if (object) {
      const words = object.split(" ");
      // "… red" at the END is a recolor request, not an object.
      if (words.length > 0 && COLOR_WORDS.has(words[words.length - 1])) object = "";
      else if (words.some((w) => NON_BUILD_WORDS.has(w))) object = "";
    }
  }

  if (!object) return null;

  object = object
    .replace(/\b(please|for me|now|quickly|holographic|hologram|3d|again)\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(a|an|the|some)\s+/, "")
    .trim();
  if (!object || object.split(" ").length > 6) return null;
  return { object, forceDesign: FORCE_DESIGN_RE.test(t) };
}

export type DeleteCommand = { all: true } | { name: string };

/**
 * "delete the lighthouse" / "remove the tree house model" /
 * "clear the workbench" / "delete all models" → actionable command.
 */
export function matchDeleteCommand(input: string, modelNames: string[]): DeleteCommand | null {
  const t = benchify(normalizeUtterance(input));
  if (!t) return null;
  if (QUESTION_RE.test(t)) return null; // "why did you delete my chair?" → chat

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

/* ------------------------------------------------------------------ */
/* Reality physics stress test commands                                 */
/* ------------------------------------------------------------------ */

export interface StressCommand {
  /** The object to test — "" means "it"/"the model" (referent). */
  object: string;
}

/**
 * "run a stress test for the chair" / "stress test the ladder" /
 * "do a physics stress test on it" / "run a reality stress test for my
 * bridge" → the reality physics stress test command.
 */
export function matchStressTestCommand(input: string): StressCommand | null {
  const t = normalizeUtterance(input);
  if (!t) return null;
  if (QUESTION_RE.test(t)) return null; // "what does the stress test do?" → chat
  if (!/\bstress\s+tests?\b/.test(t)) return null;

  // "run/do/perform … stress test for/on/of X"
  let m =
    t.match(/\bstress\s+tests?\s+(?:for|on|of)\s+(.+)$/) ??
    t.match(/\bstress\s+tests?\s+(?:the|a|an|my|this|that|it|them|him|her)\s*(.*)$/);
  if (!m) return null;

  let object = (m[1] ?? "").trim();
  // "run a stress test" with a bare referent ("stress test it")
  object = object
    .replace(/^(?:the|a|an|my|this|that|some)\s+/, "")
    .replace(/\b(?:model|hologram|holographic|please|now|quickly|again)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Pronouns are referents, not object names ("stress test for it").
  if (/^(?:it|them|this|that|one|him|her|the one|the model|the object)$/.test(object)) {
    object = "";
  }
  if (object.split(" ").length > 6) return null;
  return { object };
}

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
  // Same for the bench-tool verbs (tidy, snapshot, blueprint, scenes) —
  // short utterances like "tidy the workbench" would otherwise read as
  // a bare "open".
  if (
    /\b(delete|remove|destroy|clear|wipe|empty|reset|tidy|arrange|organize|straighten|neaten|blueprint|blueprints|snapshot|screenshot|photo|picture|capture|scene|scenes)\b/.test(
      t
    )
  )
    return null;

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
  "another", "copy", "clone", "duplicate",
]);

/** Color words — legitimate inside an object ("red telephone") but a recolor
 * request when they come LAST ("make the chair red"). */
const COLOR_WORDS = new Set([
  "red", "blue", "green", "yellow", "purple", "orange", "white", "black", "pink",
  "gray", "grey", "brown", "gold", "silver", "cyan", "magenta", "teal", "navy",
  "tan", "beige",
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

/** Word-subset model-name match: every significant word of a model's name
 *  appears in the utterance ("rocket" matches "Rocket Ship"). Shared by the
 *  delete and style/motion matchers. */
function resolveTargetName(t: string, modelNames: string[]): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/s\b/g, "").replace(/\s+/g, " ").trim();
  const textWords = norm(t);
  for (const name of modelNames) {
    const words = norm(name).split(" ").filter((w) => w.length > 2);
    if (words.length > 0 && words.every((w) => textWords.includes(w))) {
      return name;
    }
  }
  return undefined;
}

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

  const target = resolveTargetName(t, modelNames);
  return target ? { name: target } : null;
}

/* ------------------------------------------------------------------ */
/* Style & motion commands: recolor / spin / explode / duplicate        */
/* ------------------------------------------------------------------ */

/** One voice-driven tweak to a model already on the bench. `name` is the
 *  targeted model; undefined means "the one I mean" → the most recently
 *  built ("make it spin", "paint it red", "take it apart"). */
export type ModelAction =
  | { kind: "recolor"; name?: string; color: string; all: boolean }
  | { kind: "spin"; name?: string; on: boolean }
  | { kind: "explode"; name?: string; on: boolean }
  | { kind: "duplicate"; name?: string }
  | { kind: "xray"; name?: string; on: boolean }
  | { kind: "solid"; name?: string; on: boolean }
  | { kind: "measure"; name?: string; on: boolean }
  | { kind: "inspect"; name?: string; on: boolean }
  | { kind: "focus"; name?: string; on: boolean };

/** Colors the recolor command accepts (all resolvable through the vision
 *  palette — grey normalizes to gray). */
const STYLE_COLORS = new Set([
  "red", "blue", "green", "yellow", "purple", "orange", "white", "black", "pink",
  "gray", "grey", "brown", "gold", "silver", "cyan", "magenta", "teal", "navy",
  "tan", "beige",
]);

const RECOLOR_VERB_RE = /\b(make|paint|recolor|recolour|color|colour|turn|change|switch|dye)\b/;

/** Trailing filler stripped before the color-final check ("make it red
 *  again" → recolor, not a build of "it red again"). */
const TAIL_FILLER_RE = /(?:\s+\b(?:please|now|again|too|thanks|thank you)\b)+$/;

/** "off" verbs shared by the toggle-style view commands. */
const OFF_RE = /\b(stop|halt|end|cease|quit|kill|off|disable|hide|remove|close|exit)\b/;
/** Normal-again phrasing ("back to normal", "regular view"). */
const NORMAL_RE = /\b(normal|regular|normal view|regular view|back to normal)\b/;

/**
 * Voice tweaks for models already on the bench: spinning, exploded view,
 * duplication, recoloring. Runs BEFORE the build matcher ("make another
 * one" is a duplicate, not a new design) but AFTER open/close and delete.
 * Every branch requires a reference to something that exists — a model name
 * or it/that/this — so build requests like "build a spinning top" or "make
 * a red rocket" are never hijacked.
 */
export function matchModelAction(input: string, modelNames: string[]): ModelAction | null {
  const t = normalizeUtterance(input);
  if (!t) return null;
  if (QUESTION_RE.test(t)) return null; // "how do I make it spin?" → chat

  const name = resolveTargetName(t, modelNames);
  const refers = name !== undefined || /\b(it|that|this|one|turntable)\b/.test(t);
  const imperative = /^(?:spin|rotate|stop|start|keep|begin)\b/.test(t);

  // SPIN — "make it spin" / "spin the rocket" / "stop spinning".
  if (/\b(spin|spinning|turntable|rotate|rotating|rotation)\b/.test(t) && (refers || imperative)) {
    const off = /\b(stop|halt|end|cease|freeze|quit|kill|still)\b/.test(t);
    return { kind: "spin", name, on: !off };
  }

  // EXPLODED VIEW — "take it apart" / "explode the rocket" /
  // "put it back together" / "reassemble it".
  if (/\b(reassemble|reassembled|back together|together again|put it together)\b/.test(t)) {
    return { kind: "explode", name, on: false };
  }
  if (
    /\b(explode|exploded|exploding|disassemble|apart|pieces)\b/.test(t) &&
    (refers || /^(?:explode|disassemble)\b/.test(t))
  ) {
    return { kind: "explode", name, on: true };
  }

  // DUPLICATE — "copy the rocket" / "clone it" / "make another one".
  if (/\b(duplicate|clone|copy)\b/.test(t)) {
    if (name !== undefined || /\b(it|that|this|one)\b/.test(t)) {
      return { kind: "duplicate", name };
    }
  }
  if (/\b(another|one more)\b/.test(t) && /\b(make|build|give|want|need)\b/.test(t)) {
    if (name !== undefined || /\b(one|it|that)\b/.test(t)) {
      return { kind: "duplicate", name };
    }
  }

  // X-RAY — "x-ray the rocket" / "x-ray mode" / "turn off the x-ray".
  if (
    /\bx ?rays?\b|\bxray\b/.test(t) &&
    (refers || /^(?:x ?ray|turn|stop|start|kill|switch)\b/.test(t))
  ) {
    const off = OFF_RE.test(t) || NORMAL_RE.test(t);
    return { kind: "xray", name, on: !off };
  }

  // SOLID — "make it solid" / "make it a hologram again". A make/turn
  // verb plus a reference (or the model's name) is required, so "build a
  // solid gold statue" still reaches the builders untouched.
  if (refers && /\b(make|turn|render|switch|go|give)\b/.test(t)) {
    if (/\bsolid\b|\bopaque\b/.test(t)) return { kind: "solid", name, on: true };
    if (/\b(hologram|holographic|holo|ghost|translucent|glass)\b/.test(t)) {
      return { kind: "solid", name, on: false };
    }
  }

  // MEASURE — "measure the rocket" / "show the dimensions" /
  // "hide the measurements".
  if (
    /\b(measure|measured|measuring|measurements?|dimensions?|ruler)\b/.test(t) &&
    (refers || /^(?:measure|show|hide|display|turn|stop|start|kill|switch)\b/.test(t))
  ) {
    const off = /\b(hide|remove)\b/.test(t) || (OFF_RE.test(t) && !/\b(show|display)\b/.test(t));
    return { kind: "measure", name, on: !off };
  }

  // INSPECTOR — "inspect the rocket" / "show me the specs" /
  // "close the inspector".
  if (
    /\b(inspect|inspector|inspection|readout|specs?|details?)\b/.test(t) &&
    (refers || /^(?:inspect|open|close|stop|hide|show|end|turn|start|kill|switch)\b/.test(t))
  ) {
    const off = OFF_RE.test(t) && !/\b(show|display)\b/.test(t);
    return { kind: "inspect", name, on: !off };
  }

  // FOCUS / PRESENTATION — "focus on the rocket" / "present the rocket" /
  // "stop focusing" / "end the presentation".
  if (
    /\b(focus|focused|focusing|present|presentation|spotlight|showcase)\b/.test(t) &&
    (refers || /^(?:focus|present|spotlight|showcase|stop|end|exit|quit|unfocus|turn|start|kill|switch)\b/.test(t))
  ) {
    const off = OFF_RE.test(t) || /^unfocus\b/.test(t);
    return { kind: "focus", name, on: !off };
  }

  // RECOLOR — "make the rocket red" / "paint it gold" / "change the color
  // to teal". The color must be the FINAL word (after trailing fillers), so
  // "build a red rocket" still reaches the builders.
  const core = t.replace(TAIL_FILLER_RE, "");
  const words = core.split(" ").filter(Boolean);
  const last = words[words.length - 1];
  if (last && STYLE_COLORS.has(last) && RECOLOR_VERB_RE.test(core)) {
    const all = /\b(all|everything|whole|entire|fully|completely)\b/.test(core);
    return { kind: "recolor", name, color: last === "grey" ? "gray" : last, all };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Bench tools: blueprint / tidy / snapshot / scenes / undo             */
/* ------------------------------------------------------------------ */

/** A whole-bench tool command — not tied to one model. Numbered scene
 *  slots are 0-based internally ("scene two" → slot 1). */
export type BenchTool =
  | { kind: "blueprint"; on: boolean }
  | { kind: "tidy" }
  | { kind: "snapshot" }
  | { kind: "scene-save"; slot?: number }
  | { kind: "scene-load"; slot?: number }
  | { kind: "undo-delete" };

const SLOT_WORDS: Record<string, number> = { one: 0, two: 1, three: 2, "1": 0, "2": 1, "3": 2 };

/** "scene two" / "slot 3" → 0-based slot index. */
function parseSceneSlot(t: string): number | undefined {
  const m = t.match(/\b(?:scene|slot|setup)\s+(one|two|three|1|2|3)\b/);
  if (!m) return undefined;
  const slot = SLOT_WORDS[m[1]];
  return slot === undefined ? undefined : slot;
}

/**
 * Whole-bench voice tools: blueprint view, auto-arrange, PNG snapshot,
 * scene save/load, and bring-it-back undo for deletions. Matched after
 * open/close and delete, before the per-model actions. Every branch needs
 * its tool word, so everyday conversation never trips one.
 */
export function matchBenchTool(input: string): BenchTool | null {
  const t = normalizeUtterance(input);
  if (!t) return null;
  if (QUESTION_RE.test(t)) return null; // "how do scenes work?" → chat

  // UNDO DELETE — "bring it back" / "undo that" / "restore it". Deletion
  // words for OTHER tweaks (explode, spin, recolor) fall through to the
  // model-action matcher instead ("undo the explode" → put back together).
  const undoish =
    /\bundo\b/.test(t) ||
    /\bbring (it|that|them) back\b/.test(t) ||
    /\brestore (it|that)\b/.test(t) ||
    /\bi didnt (want|mean) (to|that)\b/.test(t) ||
    /\boops\b/.test(t);
  if (
    undoish &&
    !/\b(explode|exploded|apart|spin|spinning|together|color|colour|paint|recolor|recolour|scene|solid|x ?ray)\b/.test(t)
  ) {
    return { kind: "undo-delete" };
  }

  // SCENES — needs the word "scene"/"scenes" plus a save or load verb, so
  // "build a city scene" is never hijacked (no save/load verb → build).
  if (/\bscenes?\b/.test(t)) {
    const slot = parseSceneSlot(t);
    if (/\b(save|keep|store|record)\b/.test(t)) return { kind: "scene-save", slot };
    if (/\b(load|restore|open|recall|resume|switch|bring up|bring back)\b/.test(t)) {
      return { kind: "scene-load", slot };
    }
  }

  // SNAPSHOT — "take a snapshot" / "screenshot the workbench" /
  // "capture the bench" / "take a photo of the workbench".
  if (/\b(snapshot|screenshots?|screen shot)\b/.test(t)) return { kind: "snapshot" };
  if (/\b(photo|picture|capture)\b/.test(t) && /\b(take|snap|capture|save|of)\b/.test(t)) {
    return { kind: "snapshot" };
  }
  if (/\bcapture\b/.test(t) && /\b(workbench|bench|models?|scene|everything|this)\b/.test(t)) {
    return { kind: "snapshot" };
  }

  // BLUEPRINT — "blueprint mode" / "exit blueprint mode".
  if (/\bblue ?prints?\b/.test(t)) {
    const off = OFF_RE.test(t) || NORMAL_RE.test(t);
    return { kind: "blueprint", on: !off };
  }

  // TIDY / AUTO-ARRANGE — "tidy the workbench" / "arrange the models" /
  // "line them up" / "spread everything out".
  if (
    /\b(tidy|arrange|organize|organise|straighten|neaten|line up|lined up)\b/.test(t) &&
    /\b(workbench|bench|models?|everything|them|up|out|grid|layout)\b/.test(t)
  ) {
    return { kind: "tidy" };
  }

  return null;
}

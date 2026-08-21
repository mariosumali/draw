/**
 * Narration script for the guessing voice.
 *
 * Everything here is pure: an event in, a spoken line (plus prosody hints) out.
 * The phrasing mimics Google's Quick, Draw! narrator — it thinks out loud,
 * fires off rapid follow-up guesses as the sketch changes, and lands on the
 * signature "Oh, I know, it's a ..." when it finally recognizes the prompt.
 */

import { isMatchingPrediction } from "@/lib/game/guesses";
import type { Prediction } from "@/lib/game/types";
import { CHATTINESS_GUESS_LIMIT, type VoiceChattiness } from "./voice-settings";

export type NarrationPriority = "low" | "normal" | "high";

export type NarrationEvent =
  | { kind: "thinking"; seed: string }
  | { kind: "guess"; label: string; index: number; confidence: number; seed: string }
  | { kind: "recognized"; label: string; seed: string }
  | { kind: "stumped"; seed: string }
  | { kind: "prompt"; prompt: string; seed: string };

export type NarrationLine = {
  kind: NarrationEvent["kind"];
  text: string;
  /** Multiplied against the listener's configured rate. */
  rateScale: number;
  /** Multiplied against the listener's configured pitch. */
  pitchScale: number;
  priority: NarrationPriority;
  /** Repeat suppression key — same key inside the cooldown is skipped. */
  dedupeKey: string;
};

/** Below this the narrator hedges instead of committing to a guess. */
export const LOW_CONFIDENCE = 0.15;
/** At or above this it drops the question mark and states the guess. */
export const HIGH_CONFIDENCE = 0.6;

const THINKING_LINES = [
  "Hmm...",
  "Let me see...",
  "Hold on, I'm looking...",
  "Ooh, what is that?",
  "I'm thinking...",
  "Okay, okay...",
];

const FIRST_GUESS_LINES = [
  "I see {label}.",
  "Is that {label}?",
  "That looks like {label}.",
  "Ooh, {label}?",
  "I'm seeing {label}.",
];

const CONFIDENT_GUESS_LINES = [
  "That's {label}.",
  "Definitely {label}.",
  "I'm pretty sure that's {label}.",
  "Okay, {label}.",
];

const FOLLOW_UP_GUESS_LINES = [
  "Or maybe {label}.",
  "Could be {label}.",
  "Wait, {label}?",
  "Maybe {label}?",
  "Or {label}?",
  "Hmm, {label}?",
];

const HEDGED_GUESS_LINES = [
  "I don't know... {label}?",
  "Something like {label}?",
  "Maybe... {label}? I'm not sure.",
  "Kind of like {label}?",
];

const RECOGNIZED_LINES = [
  "Oh, I know! It's {label}!",
  "I've got it, {label}!",
  "Yes! {label}!",
  "Oh! That's {label}!",
  "Got it, it's {label}!",
];

const STUMPED_LINES = [
  "Hmm, I'm stumped.",
  "I have no idea what that is.",
  "I really can't tell.",
  "Nope, I'm lost.",
  "That one's got me.",
];

const PROMPT_LINES = [
  "Okay, draw {label}.",
  "Next up, {label}.",
  "Now try {label}.",
];

/** Plurals and mass nouns that read wrong with "a"/"an" in front. */
const NO_ARTICLE_LABELS = new Set([
  "animal migration",
  "asparagus",
  "binoculars",
  "camouflage",
  "drums",
  "eyeglasses",
  "flip flops",
  "grapes",
  "grass",
  "headphones",
  "ice cream",
  "lightning",
  "matches",
  "pants",
  "peas",
  "pliers",
  "rain",
  "rollerskates",
  "scissors",
  "shorts",
  "stairs",
  "stitches",
  "toothpaste",
  "underwear",
]);

/** Consonant-sounding vowel starts ("a unicycle") and silent-h words ("an hourglass"). */
const CONSONANT_SOUND_PREFIXES = ["uni", "use", "usu", "uti", "ufo", "eu", "one", "ewe"];
const VOWEL_SOUND_PREFIXES = ["hour", "honest", "honor", "heir"];

/** Turns a model label ("stop_sign", "The Mona Lisa") into something speakable. */
export function toSpeakableLabel(label: string) {
  return label
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Picks "a", "an", or nothing for a label. */
export function articleFor(label: string) {
  const speakable = toSpeakableLabel(label);
  if (!speakable) {
    return "";
  }

  if (speakable.startsWith("the ") || NO_ARTICLE_LABELS.has(speakable)) {
    return "";
  }

  if (VOWEL_SOUND_PREFIXES.some((prefix) => speakable.startsWith(prefix))) {
    return "an";
  }

  if (CONSONANT_SOUND_PREFIXES.some((prefix) => speakable.startsWith(prefix))) {
    return "a";
  }

  return /^[aeiou]/.test(speakable) ? "an" : "a";
}

/** "cat" -> "a cat", "eyeglasses" -> "eyeglasses", "The Mona Lisa" -> "the mona lisa". */
export function withArticle(label: string) {
  const speakable = toSpeakableLabel(label);
  const article = articleFor(speakable);
  return article ? `${article} ${speakable}` : speakable;
}

/** FNV-1a — small, stable, and dependency free, so variants are reproducible. */
function hashSeed(seed: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** Deterministically chooses one phrasing from a pool. */
export function pickVariant(pool: readonly string[], seed: string) {
  if (pool.length === 0) {
    return "";
  }

  return pool[hashSeed(seed) % pool.length];
}

function fill(template: string, label: string) {
  return template.replace("{label}", withArticle(label));
}

function guessPool(index: number, confidence: number) {
  if (confidence < LOW_CONFIDENCE) {
    return HEDGED_GUESS_LINES;
  }

  if (index === 0) {
    return confidence >= HIGH_CONFIDENCE ? CONFIDENT_GUESS_LINES : FIRST_GUESS_LINES;
  }

  return FOLLOW_UP_GUESS_LINES;
}

/** Builds the spoken line for a narration event. */
export function buildNarrationLine(event: NarrationEvent): NarrationLine {
  switch (event.kind) {
    case "thinking":
      return {
        kind: "thinking",
        text: pickVariant(THINKING_LINES, event.seed),
        rateScale: 0.92,
        pitchScale: 0.97,
        priority: "low",
        dedupeKey: "thinking",
      };

    case "guess": {
      const pool = guessPool(event.index, event.confidence);
      const hedged = event.confidence < LOW_CONFIDENCE;
      const followUp = event.index > 0;

      return {
        kind: "guess",
        text: fill(pickVariant(pool, `${event.seed}:${event.label}:${event.index}`), event.label),
        rateScale: hedged ? 0.95 : followUp ? 1.06 : 1,
        pitchScale: hedged ? 0.96 : followUp ? 1.03 : 1,
        priority: "normal",
        dedupeKey: `guess:${toSpeakableLabel(event.label)}`,
      };
    }

    case "recognized":
      return {
        kind: "recognized",
        text: fill(pickVariant(RECOGNIZED_LINES, `${event.seed}:${event.label}`), event.label),
        rateScale: 1.14,
        pitchScale: 1.14,
        priority: "high",
        dedupeKey: `recognized:${toSpeakableLabel(event.label)}`,
      };

    case "stumped":
      return {
        kind: "stumped",
        text: pickVariant(STUMPED_LINES, event.seed),
        rateScale: 0.88,
        pitchScale: 0.9,
        priority: "normal",
        dedupeKey: "stumped",
      };

    case "prompt":
      return {
        kind: "prompt",
        text: fill(pickVariant(PROMPT_LINES, `${event.seed}:${event.prompt}`), event.prompt),
        rateScale: 1,
        pitchScale: 1,
        priority: "high",
        dedupeKey: `prompt:${toSpeakableLabel(event.prompt)}`,
      };
  }
}

export type NarrationScriptOptions = {
  /** Ranked predictions, best first. */
  predictions: Prediction[];
  /** Target word, if the sketch has one. */
  prompt?: string;
  chattiness?: VoiceChattiness;
  /** Varies the phrasing; the same seed always produces the same script. */
  seed: string;
  /** Open with a "Hmm..." filler line. */
  includeThinking?: boolean;
};

/**
 * The whole thing the narrator would say about one set of predictions, in
 * order. The live hook speaks guess-by-guess as they are revealed; this is the
 * offline equivalent, for replaying a finished prediction set out loud.
 */
export function buildNarrationScript({
  predictions,
  prompt,
  chattiness = "normal",
  seed,
  includeThinking = true,
}: NarrationScriptOptions): NarrationLine[] {
  const lines: NarrationLine[] = [];
  if (predictions.length === 0) {
    return lines;
  }

  if (includeThinking && chattiness !== "quiet") {
    lines.push(buildNarrationLine({ kind: "thinking", seed }));
  }

  const guessLimit = CHATTINESS_GUESS_LIMIT[chattiness];
  let recognized = false;

  for (const [index, prediction] of predictions.entries()) {
    // Recognition beats the chattiness budget — the game scores on it either way.
    if (prompt && isMatchingPrediction(prompt, prediction)) {
      lines.push(buildNarrationLine({ kind: "recognized", label: prediction.label, seed }));
      recognized = true;
      break;
    }

    if (index < guessLimit) {
      lines.push(
        buildNarrationLine({
          kind: "guess",
          label: prediction.label,
          index,
          confidence: prediction.confidence,
          seed,
        }),
      );
    }
  }

  if (prompt && !recognized && chattiness !== "quiet") {
    lines.push(buildNarrationLine({ kind: "stumped", seed }));
  }

  return lines;
}

/** Rough spoken duration, used as a watchdog when `onend` never fires. */
export function estimateSpeechDurationMs(text: string, rate: number) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const safeRate = rate > 0 ? rate : 1;
  return Math.max(700, Math.round(((words / 2.6) * 1000) / safeRate) + 350);
}

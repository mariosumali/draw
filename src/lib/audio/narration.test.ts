import { describe, expect, it } from "vitest";

import {
  articleFor,
  buildNarrationLine,
  buildNarrationScript,
  estimateSpeechDurationMs,
  pickVariant,
  toSpeakableLabel,
  withArticle,
} from "@/lib/audio/narration";
import type { Prediction } from "@/lib/game/types";

describe("toSpeakableLabel", () => {
  it("turns model labels into plain spoken words", () => {
    expect(toSpeakableLabel("stop_sign")).toBe("stop sign");
    expect(toSpeakableLabel("hot-air-balloon")).toBe("hot air balloon");
    expect(toSpeakableLabel("  The Mona Lisa  ")).toBe("the mona lisa");
  });
});

describe("articleFor", () => {
  it("uses 'a' before consonant sounds and 'an' before vowel sounds", () => {
    expect(articleFor("cat")).toBe("a");
    expect(articleFor("stop_sign")).toBe("a");
    expect(articleFor("apple")).toBe("an");
    expect(articleFor("octopus")).toBe("an");
    expect(articleFor("umbrella")).toBe("an");
    expect(articleFor("onion")).toBe("an");
  });

  it("follows the sound, not the spelling", () => {
    expect(articleFor("hourglass")).toBe("an");
    expect(articleFor("unicycle")).toBe("a");
    expect(articleFor("one")).toBe("a");
  });

  it("drops the article for plurals, mass nouns, and 'The ...' categories", () => {
    expect(articleFor("eyeglasses")).toBe("");
    expect(articleFor("scissors")).toBe("");
    expect(articleFor("ice cream")).toBe("");
    expect(articleFor("The Great Wall of China")).toBe("");
    expect(articleFor("")).toBe("");
  });
});

describe("withArticle", () => {
  it("builds the spoken noun phrase", () => {
    expect(withArticle("cat")).toBe("a cat");
    expect(withArticle("stop_sign")).toBe("a stop sign");
    expect(withArticle("headphones")).toBe("headphones");
    expect(withArticle("The Eiffel Tower")).toBe("the eiffel tower");
  });
});

describe("pickVariant", () => {
  it("is deterministic for the same seed", () => {
    const pool = ["one", "two", "three", "four"];
    expect(pickVariant(pool, "sig:cat:0")).toBe(pickVariant(pool, "sig:cat:0"));
  });

  it("spreads different seeds across the pool", () => {
    const pool = ["one", "two", "three", "four"];
    const picks = new Set(Array.from({ length: 40 }, (_, index) => pickVariant(pool, `seed-${index}`)));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("survives an empty pool", () => {
    expect(pickVariant([], "seed")).toBe("");
  });
});

describe("buildNarrationLine", () => {
  it("asks about its first guess and names the label", () => {
    const line = buildNarrationLine({
      kind: "guess",
      label: "stop_sign",
      index: 0,
      confidence: 0.4,
      seed: "sig",
    });

    expect(line.text).toContain("a stop sign");
    expect(line.kind).toBe("guess");
    expect(line.priority).toBe("normal");
    expect(line.dedupeKey).toBe("guess:stop sign");
  });

  it("hedges on low confidence and speeds up on follow-up guesses", () => {
    const hedged = buildNarrationLine({ kind: "guess", label: "boat", index: 0, confidence: 0.05, seed: "s" });
    const followUp = buildNarrationLine({ kind: "guess", label: "boat", index: 2, confidence: 0.3, seed: "s" });
    const confident = buildNarrationLine({ kind: "guess", label: "boat", index: 0, confidence: 0.9, seed: "s" });

    expect(hedged.rateScale).toBeLessThan(1);
    expect(followUp.rateScale).toBeGreaterThan(1);
    expect(confident.text).not.toContain("?");
  });

  it("lands the Quick Draw payoff line and interrupts for it", () => {
    const line = buildNarrationLine({ kind: "recognized", label: "elephant", seed: "sig" });

    expect(line.text).toContain("an elephant");
    expect(line.text).toContain("!");
    expect(line.priority).toBe("high");
    expect(line.pitchScale).toBeGreaterThan(1);
    expect(line.rateScale).toBeGreaterThan(1);
  });

  it("uses droppable filler while it is still thinking", () => {
    const line = buildNarrationLine({ kind: "thinking", seed: "sig" });

    expect(line.priority).toBe("low");
    expect(line.dedupeKey).toBe("thinking");
    expect(line.text.length).toBeGreaterThan(0);
  });

  it("slows down when it gives up", () => {
    const line = buildNarrationLine({ kind: "stumped", seed: "sig" });

    expect(line.rateScale).toBeLessThan(1);
    expect(line.pitchScale).toBeLessThan(1);
    expect(line.dedupeKey).toBe("stumped");
  });

  it("reads the next prompt out loud", () => {
    const line = buildNarrationLine({ kind: "prompt", prompt: "sleepy robot", seed: "sig" });

    expect(line.text).toContain("a sleepy robot");
    expect(line.priority).toBe("high");
  });

  it("varies phrasing across different guesses", () => {
    const labels = ["cat", "dog", "boat", "tree", "car", "hat"];
    const texts = new Set(
      labels.map(
        (label) => buildNarrationLine({ kind: "guess", label, index: 0, confidence: 0.4, seed: "sig" }).text,
      ),
    );

    expect(texts.size).toBeGreaterThan(1);
  });
});

describe("buildNarrationScript", () => {
  // "duck" and "swan" sit below RECOGNITION_CONFIDENCE, so they can never win.
  const PREDICTIONS: Prediction[] = [
    { label: "pelican", confidence: 0.61 },
    { label: "bird", confidence: 0.52 },
    { label: "flamingo", confidence: 0.46 },
    { label: "duck", confidence: 0.03 },
    { label: "swan", confidence: 0.02 },
  ];

  it("opens with filler, then names guesses up to the chattiness budget", () => {
    const kinds = buildNarrationScript({ predictions: PREDICTIONS, seed: "s" }).map((line) => line.kind);

    expect(kinds).toEqual(["thinking", "guess", "guess"]);
  });

  it("reads the whole ranking when chatty", () => {
    const script = buildNarrationScript({ predictions: PREDICTIONS, chattiness: "chatty", seed: "s" });

    expect(script.filter((line) => line.kind === "guess")).toHaveLength(5);
    expect(script.map((line) => line.text).join(" ")).toContain("a swan");
  });

  it("skips the filler when quiet and names only the top guess", () => {
    const script = buildNarrationScript({ predictions: PREDICTIONS, chattiness: "quiet", seed: "s" });

    expect(script.map((line) => line.kind)).toEqual(["guess"]);
  });

  it("stops at the prompt and celebrates it", () => {
    const script = buildNarrationScript({ predictions: PREDICTIONS, prompt: "bird", seed: "s" });

    expect(script.map((line) => line.kind)).toEqual(["thinking", "guess", "recognized"]);
    expect(script.at(-1)!.text).toContain("a bird");
  });

  it("celebrates a match ranked past the chattiness budget", () => {
    const script = buildNarrationScript({
      predictions: PREDICTIONS,
      prompt: "flamingo",
      chattiness: "quiet",
      seed: "s",
    });

    expect(script.map((line) => line.kind)).toEqual(["guess", "recognized"]);
  });

  it("ignores a match below the recognition threshold", () => {
    const script = buildNarrationScript({ predictions: PREDICTIONS, prompt: "duck", seed: "s" });

    expect(script.map((line) => line.kind)).toEqual(["thinking", "guess", "guess", "stumped"]);
  });

  it("gives up only when there was a prompt to miss", () => {
    const withoutPrompt = buildNarrationScript({ predictions: PREDICTIONS, seed: "s" });
    const withPrompt = buildNarrationScript({ predictions: PREDICTIONS, prompt: "boat", seed: "s" });

    expect(withoutPrompt.some((line) => line.kind === "stumped")).toBe(false);
    expect(withPrompt.at(-1)!.kind).toBe("stumped");
  });

  it("can skip the opening filler", () => {
    const script = buildNarrationScript({ predictions: PREDICTIONS, seed: "s", includeThinking: false });

    expect(script[0].kind).toBe("guess");
  });

  it("says nothing about an empty ranking", () => {
    expect(buildNarrationScript({ predictions: [], prompt: "cat", seed: "s" })).toEqual([]);
  });

  it("is deterministic for the same seed", () => {
    const first = buildNarrationScript({ predictions: PREDICTIONS, seed: "s" }).map((line) => line.text);
    const second = buildNarrationScript({ predictions: PREDICTIONS, seed: "s" }).map((line) => line.text);

    expect(first).toEqual(second);
  });
});

describe("estimateSpeechDurationMs", () => {
  it("grows with length and shrinks with rate", () => {
    const short = estimateSpeechDurationMs("Hmm...", 1);
    const long = estimateSpeechDurationMs("Oh, I know! It's a hot air balloon!", 1);
    const fast = estimateSpeechDurationMs("Oh, I know! It's a hot air balloon!", 2);

    expect(long).toBeGreaterThan(short);
    expect(fast).toBeLessThan(long);
    expect(short).toBeGreaterThanOrEqual(700);
  });
});

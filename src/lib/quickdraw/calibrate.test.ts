import { describe, expect, it } from "vitest";

import { QUICK_DRAW_PROMPTS } from "@/lib/game/prompts";
import { normalizeLabel, RECOGNITION_CONFIDENCE } from "@/lib/game/types";
import {
  calibrateQuickDrawPredictions,
  getLabelConfidenceMultipliers,
  MIN_VIABLE_MULTIPLIER,
} from "@/lib/quickdraw/calibrate";

describe("calibrateQuickDrawPredictions", () => {
  it("passes predictions through untouched when nothing is calibrated", () => {
    const predictions = [
      { label: "cat", confidence: 0.9 },
      { label: "rain", confidence: 0.8 },
      { label: "animal migration", confidence: 0.7 },
      { label: "camouflage", confidence: 0.6 },
    ];

    expect(calibrateQuickDrawPredictions(predictions)).toEqual(predictions);
  });

  it("preserves order and length", () => {
    const predictions = [
      { label: "a", confidence: 0.3 },
      { label: "b", confidence: 0.2 },
    ];
    const calibrated = calibrateQuickDrawPredictions(predictions);

    expect(calibrated).toHaveLength(2);
    expect(calibrated.map((prediction) => prediction.label)).toEqual(["a", "b"]);
  });

  it("handles an empty prediction list", () => {
    expect(calibrateQuickDrawPredictions([])).toEqual([]);
  });
});

/**
 * Every Quick Draw category is a game prompt, so a label suppressed below the
 * recognition threshold is not down-ranked - it is unwinnable. That is how `rain`
 * ended up impossible to score despite being one of the best-recognised classes in
 * the set. Any future entry has to clear this bar.
 */
describe("label confidence multipliers", () => {
  const multipliers = getLabelConfidenceMultipliers();

  it("never suppresses a prompt out of reach of the game", () => {
    const unwinnable = [...multipliers.entries()].filter(
      ([label, multiplier]) =>
        multiplier < MIN_VIABLE_MULTIPLIER &&
        QUICK_DRAW_PROMPTS.some((prompt) => normalizeLabel(prompt) === label),
    );

    expect(unwinnable).toEqual([]);
  });

  it("only ever reduces confidence, and only for real labels", () => {
    for (const [label, multiplier] of multipliers) {
      expect(multiplier).toBeGreaterThan(0);
      expect(multiplier).toBeLessThanOrEqual(1);
      expect(label).toBe(normalizeLabel(label));
    }
  });

  it("leaves a confidently recognised drawing above the scoring threshold", () => {
    for (const [label, multiplier] of multipliers) {
      const [calibrated] = calibrateQuickDrawPredictions([{ label, confidence: 1 }]);
      expect(
        calibrated.confidence,
        `"${label}" is capped at ${multiplier}, below the ${RECOGNITION_CONFIDENCE} needed to score`,
      ).toBeGreaterThanOrEqual(RECOGNITION_CONFIDENCE);
    }
  });
});

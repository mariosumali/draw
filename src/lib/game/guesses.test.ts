import { describe, expect, it } from "vitest";

import { getPredictionSignature, isMatchingPrediction } from "@/lib/game/guesses";

describe("getPredictionSignature", () => {
  it("normalizes labels and buckets confidence so tiny score movement does not restart guesses", () => {
    const first = getPredictionSignature([
      { label: "Stop_Sign", confidence: 0.721 },
      { label: "blackberry", confidence: 0.118 },
    ]);
    const second = getPredictionSignature([
      { label: "stop sign", confidence: 0.729 },
      { label: "blackberry", confidence: 0.119 },
    ]);

    expect(first).toBe(second);
  });

  it("changes when top labels change", () => {
    expect(
      getPredictionSignature([
        { label: "cat", confidence: 0.8 },
        { label: "dog", confidence: 0.7 },
      ]),
    ).not.toBe(
      getPredictionSignature([
        { label: "dog", confidence: 0.8 },
        { label: "cat", confidence: 0.7 },
      ]),
    );
  });
});

describe("isMatchingPrediction", () => {
  it("matches normalized labels above the recognition threshold", () => {
    expect(isMatchingPrediction("stop sign", { label: "stop_sign", confidence: 0.73 })).toBe(true);
  });

  it("rejects matching labels below the recognition threshold", () => {
    expect(isMatchingPrediction("stop sign", { label: "stop_sign", confidence: 0.3 })).toBe(false);
  });
});

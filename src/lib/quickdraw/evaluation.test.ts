import { describe, expect, it } from "vitest";

import {
  evaluateRecognizer,
  rankTop,
  takeStrokeFraction,
  wilsonInterval,
  type EvaluationSample,
  type ScoreRunner,
} from "@/lib/quickdraw/evaluation";
import type { Stroke } from "@/lib/quickdraw/raster";

/**
 * Unit tests for the scoring itself.
 *
 * The accuracy suite trusts these numbers, so they are checked against hand-computed
 * cases rather than against the model. A metric that quietly rounds in the model's
 * favour would make every other test meaningless.
 */

describe("rankTop", () => {
  it("returns indices ordered by score, best first", () => {
    expect(rankTop([0.1, 0.9, 0.5, 0.3], 3)).toEqual([1, 2, 3]);
  });

  it("never returns more than asked for", () => {
    expect(rankTop([5, 4, 3, 2, 1], 2)).toEqual([0, 1]);
  });

  it("handles fewer scores than the requested count", () => {
    expect(rankTop([0.2, 0.8], 5)).toEqual([1, 0]);
  });

  it("breaks ties toward the earlier index", () => {
    expect(rankTop([0.5, 0.5, 0.5], 2)).toEqual([0, 1]);
  });
});

describe("takeStrokeFraction", () => {
  const strokes: Stroke[] = [
    [{ x: 0, y: 0 }],
    [{ x: 1, y: 1 }],
    [{ x: 2, y: 2 }],
    [{ x: 3, y: 3 }],
  ];

  it("returns everything at or above a full fraction", () => {
    expect(takeStrokeFraction(strokes, 1)).toHaveLength(4);
    expect(takeStrokeFraction(strokes, 2)).toHaveLength(4);
  });

  it("keeps a prefix, because that is what a half-drawn sketch looks like", () => {
    expect(takeStrokeFraction(strokes, 0.5)).toEqual(strokes.slice(0, 2));
  });

  it("always keeps at least one stroke", () => {
    expect(takeStrokeFraction(strokes, 0)).toHaveLength(1);
    expect(takeStrokeFraction(strokes, -1)).toHaveLength(1);
  });

  it("does not alias the caller's array", () => {
    const taken = takeStrokeFraction(strokes, 1);
    taken.pop();
    expect(strokes).toHaveLength(4);
  });
});

describe("wilsonInterval", () => {
  it("brackets the observed proportion", () => {
    const [low, high] = wilsonInterval(80, 100);
    expect(low).toBeLessThan(0.8);
    expect(high).toBeGreaterThan(0.8);
  });

  it("narrows as the sample grows", () => {
    const small = wilsonInterval(80, 100);
    const large = wilsonInterval(8000, 10_000);
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0]);
  });

  it("stays inside [0, 1] at the extremes, where a normal approximation would not", () => {
    const [low, high] = wilsonInterval(0, 30);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);

    expect(wilsonInterval(30, 30)[1]).toBe(1);
  });

  it("returns a degenerate interval for an empty sample", () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
  });
});

describe("evaluateRecognizer", () => {
  const classes = ["cat", "dog", "fish"];
  const square: Stroke[] = [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ],
  ];

  const samples: EvaluationSample[] = [
    { word: "cat", strokes: square },
    { word: "dog", strokes: square },
    { word: "fish", strokes: square },
  ];

  /** Always answers "cat" first, then "dog", then "fish". */
  const alwaysCat: ScoreRunner = () => Float32Array.from([0.7, 0.2, 0.1]);

  it("scores a perfect recognizer at 1", async () => {
    let call = 0;
    const perfect: ScoreRunner = () => {
      const scores = new Float32Array(3);
      scores[call] = 1;
      call += 1;
      return scores;
    };

    const result = await evaluateRecognizer(samples, classes, perfect);
    expect(result.top1).toBe(1);
    expect(result.map3).toBe(1);
    expect(result.macroTop1).toBe(1);
  });

  it("computes top-k and MAP@3 from the rank of the right answer", async () => {
    const result = await evaluateRecognizer(samples, classes, alwaysCat);

    expect(result.samples).toBe(3);
    expect(result.top1).toBeCloseTo(1 / 3);
    expect(result.top3).toBe(1);
    // Ranks 1, 2 and 3 contribute 1, 1/2 and 1/3.
    expect(result.map3).toBeCloseTo((1 + 0.5 + 1 / 3) / 3);
  });

  it("records what each wrong answer was mistaken for", async () => {
    const result = await evaluateRecognizer(samples, classes, alwaysCat);
    expect(result.confusions).toContainEqual({ expected: "dog", predicted: "cat", count: 1 });
    expect(result.confusions).toContainEqual({ expected: "fish", predicted: "cat", count: 1 });
  });

  it("separates macro from micro accuracy", async () => {
    // Two easy 'cat' samples and one impossible 'dog'. Micro accuracy is 2/3 but
    // macro is 1/2, because macro refuses to let a well-represented class carry a
    // failing one.
    const skewed: EvaluationSample[] = [
      { word: "cat", strokes: square },
      { word: "cat", strokes: square },
      { word: "dog", strokes: square },
    ];

    const result = await evaluateRecognizer(skewed, classes, alwaysCat);
    expect(result.top1).toBeCloseTo(2 / 3);
    expect(result.macroTop1).toBeCloseTo(0.5);
  });

  it("matches labels regardless of separator or case", async () => {
    const result = await evaluateRecognizer(
      [{ word: "CAT", strokes: square }],
      ["cat", "dog", "fish"],
      alwaysCat,
    );
    expect(result.top1).toBe(1);
  });

  it("refuses to score a label the model cannot produce", async () => {
    await expect(
      evaluateRecognizer([{ word: "dragon", strokes: square }], classes, alwaysCat),
    ).rejects.toThrow(/not present in the class list/);
  });

  it("skips drawings that leave no ink instead of counting them as wrong", async () => {
    const result = await evaluateRecognizer(
      [{ word: "cat", strokes: square }, { word: "dog", strokes: [] }],
      classes,
      alwaysCat,
    );
    expect(result.samples).toBe(1);
    expect(result.top1).toBe(1);
  });

  it("reports progress across every sample", async () => {
    const seen: number[] = [];
    await evaluateRecognizer(samples, classes, alwaysCat, {
      onProgress: (completed, total) => {
        expect(total).toBe(3);
        seen.push(completed);
      },
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});

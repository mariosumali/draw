// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QUICK_DRAW_PROMPTS } from "@/lib/game/prompts";
import { normalizeLabel, RECOGNITION_CONFIDENCE, RECOGNITION_TOP_N } from "@/lib/game/types";
import { evaluateRecognizer, rankTop, type EvaluationResult } from "@/lib/quickdraw/evaluation";
import { rasterizeStrokes } from "@/lib/quickdraw/raster";
import { loadNodeRecognizer, type NodeRecognizer } from "../../../scripts/lib/node-recognizer";
import { loadEvalDrawings, type EvalDrawing } from "../../../test/helpers/fixtures";

/**
 * Measures what the recognizer actually gets right.
 *
 * This runs the shipped ONNX weights through the shipped rasterizer over held-out
 * drawings from Google's own dataset, so the numbers describe the model the game
 * serves rather than a proxy for it. Node and the browser load the same `.onnx` file
 * through the same runtime, which is what makes the result transferable.
 *
 * Thresholds sit a few points below the measured figures. The fixture is 1,380
 * drawings, so a measurement carries roughly a two-point 95% interval; the gap absorbs
 * that without letting a real regression through. Every failure mode this suite was
 * built to catch - inverted input polarity, a broken rasterizer, the wrong model file -
 * costs tens of points, not two.
 */

/** Measured 80.3% top-1 / 93.7% top-3 over 10,350 held-out drawings (npm run bench:recognizer). */
const MIN_TOP1 = 0.75;
const MIN_TOP3 = 0.9;
const MIN_MAP3 = 0.82;

describe("Quick Draw recognizer accuracy", () => {
  const drawings = loadEvalDrawings();

  let recognizer: NodeRecognizer;
  let result: EvaluationResult;
  let partial: EvaluationResult;

  beforeAll(async () => {
    recognizer = await loadNodeRecognizer("int8");
    result = await evaluateRecognizer(drawings, recognizer.classes, recognizer.run);
    partial = await evaluateRecognizer(
      drawings.filter((_, index) => index % 3 === 0),
      recognizer.classes,
      recognizer.run,
      { strokeFraction: 0.5 },
    );
  }, 240_000);

  afterAll(async () => {
    await recognizer?.release();
  });

  it("evaluates a fixture that covers the whole label set", () => {
    expect(recognizer.classes).toHaveLength(345);
    expect(new Set(drawings.map((drawing) => drawing.word)).size).toBe(345);
    expect(result.samples).toBe(drawings.length);
  });

  it("identifies most drawings outright", () => {
    expect(result.top1).toBeGreaterThan(MIN_TOP1);
  });

  it("almost always has the answer in its top three", () => {
    expect(result.top3).toBeGreaterThan(MIN_TOP3);
  });

  it("scores well on MAP@3, the Quick Draw challenge metric", () => {
    expect(result.map3).toBeGreaterThan(MIN_MAP3);
  });

  it("is not carried by a handful of easy categories", () => {
    // Macro accuracy weights every class equally. A model that aced 'circle' and
    // 'line' while failing everything rare would pass a micro-average and fail here.
    expect(result.macroTop1).toBeGreaterThan(MIN_TOP1 - 0.03);

    const dead = Object.entries(result.perClass).filter(([, accuracy]) => accuracy.top3 === 0);
    expect(dead).toEqual([]);
  });

  it("recognizes drawings confidently enough for the game's own threshold", async () => {
    // The game only scores a prompt when it lands in the top N above
    // RECOGNITION_CONFIDENCE. Accuracy alone does not guarantee that - a correct but
    // timid prediction never scores - so the shipped threshold is checked directly.
    let scored = 0;
    for (const drawing of drawings) {
      const expectedIndex = indexOfWord(recognizer.classes, drawing.word);
      const scores = await scoreDrawing(recognizer, drawing);
      if (!scores) {
        continue;
      }

      if (
        rankTop(scores, RECOGNITION_TOP_N).includes(expectedIndex) &&
        scores[expectedIndex] >= RECOGNITION_CONFIDENCE
      ) {
        scored += 1;
      }
    }

    expect(scored / drawings.length).toBeGreaterThan(0.7);
  }, 240_000);

  it("still recognizes half-finished drawings", () => {
    // The game classifies every 450ms while a player is mid-sketch, so accuracy on a
    // partial drawing matters as much as accuracy on a finished one.
    expect(partial.samples).toBeGreaterThan(400);
    expect(partial.top1).toBeGreaterThan(0.3);
    expect(partial.top3).toBeGreaterThan(0.55);
  });

  it("gets more confident as a drawing is completed", async () => {
    const subset = drawings.filter((_, index) => index % 17 === 0 && index % 3 !== 0);
    let improved = 0;
    let compared = 0;

    for (const drawing of subset) {
      if (drawing.strokes.length < 3) {
        continue;
      }

      const expectedIndex = indexOfWord(recognizer.classes, drawing.word);
      const half = rasterizeStrokes(drawing.strokes.slice(0, Math.ceil(drawing.strokes.length / 2)));
      const full = rasterizeStrokes(drawing.strokes);
      if (!half || !full) {
        continue;
      }

      compared += 1;
      const halfScore = (await recognizer.run(half))[expectedIndex];
      const fullScore = (await recognizer.run(full))[expectedIndex];
      if (fullScore >= halfScore) {
        improved += 1;
      }
    }

    expect(compared).toBeGreaterThan(20);
    expect(improved / compared).toBeGreaterThan(0.65);
  }, 120_000);

  it("can name every prompt the game asks for", () => {
    const known = new Set(recognizer.classes.map(normalizeLabel));
    const missing = QUICK_DRAW_PROMPTS.filter((prompt) => !known.has(normalizeLabel(prompt)));
    expect(missing).toEqual([]);
  });

  it("collapses if the input polarity is inverted", async () => {
    // Ink must be 1 and blank paper 0. Feeding the inverse is the exact bug this
    // recognizer shipped with, and it is invisible without a test: the model still
    // returns confident-looking predictions, they are simply wrong.
    const subset = drawings.filter((_, index) => index % 7 === 0);
    let correct = 0;

    for (const drawing of subset) {
      const input = rasterizeStrokes(drawing.strokes);
      if (!input) {
        continue;
      }

      const inverted = Float32Array.from(input, (value) => 1 - value);
      const [best] = rankTop(await recognizer.run(inverted), 1);
      if (normalizeLabel(recognizer.classes[best]) === normalizeLabel(drawing.word)) {
        correct += 1;
      }
    }

    expect(correct / subset.length).toBeLessThan(0.15);
  }, 120_000);
});

function indexOfWord(classes: readonly string[], word: string) {
  const normalized = normalizeLabel(word);
  const index = classes.findIndex((label) => normalizeLabel(label) === normalized);
  if (index < 0) {
    throw new Error(`Label "${word}" is missing from the class list.`);
  }
  return index;
}

async function scoreDrawing(recognizer: NodeRecognizer, drawing: EvalDrawing) {
  const input = rasterizeStrokes(drawing.strokes);
  return input ? recognizer.run(input) : null;
}

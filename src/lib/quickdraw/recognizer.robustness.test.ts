// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { normalizeLabel } from "@/lib/game/types";
import { rankTop } from "@/lib/quickdraw/evaluation";
import { rasterizeStrokes, type Stroke } from "@/lib/quickdraw/raster";
import { loadNodeRecognizer, type NodeRecognizer } from "../../../scripts/lib/node-recognizer";
import { loadEvalDrawings, scaleStrokes, translateStrokes } from "../../../test/helpers/fixtures";

/**
 * Metamorphic tests: properties that must hold between two related inputs, without
 * anyone having to know the right answer for either.
 *
 * These catch a different class of bug than accuracy does. A recognizer can score well
 * on a benchmark and still be unusable in a game if it reads a drawing differently
 * depending on where the player put it, how big they drew it, or which quantized build
 * happens to be deployed.
 */
describe("Quick Draw recognizer robustness", () => {
  const drawings = loadEvalDrawings().filter((_, index) => index % 23 === 0);

  let recognizer: NodeRecognizer;
  let float32: NodeRecognizer;

  beforeAll(async () => {
    recognizer = await loadNodeRecognizer("int8");
    float32 = await loadNodeRecognizer("float32");
  }, 120_000);

  afterAll(async () => {
    await recognizer?.release();
    await float32?.release();
  });

  it("has a meaningful number of drawings to check", () => {
    expect(drawings.length).toBeGreaterThan(50);
  });

  it("reads a drawing the same wherever it sits on the canvas", async () => {
    for (const drawing of drawings.slice(0, 40)) {
      const reference = await predict(recognizer, drawing.strokes);
      const moved = await predict(recognizer, translateStrokes(drawing.strokes, 317, -122));
      expect(moved.label).toBe(reference.label);
      expect(moved.confidence).toBeCloseTo(reference.confidence, 5);
    }
  }, 120_000);

  it("reads a drawing the same however large it was drawn", async () => {
    for (const drawing of drawings.slice(0, 40)) {
      const reference = await predict(recognizer, drawing.strokes);
      for (const factor of [0.25, 4]) {
        const resized = await predict(recognizer, scaleStrokes(drawing.strokes, factor));
        expect(resized.label).toBe(reference.label);
        expect(resized.confidence).toBeCloseTo(reference.confidence, 3);
      }
    }
  }, 120_000);

  it("does not care which order the strokes arrived in", async () => {
    // The renderer paints opaque ink, so stroke order cannot matter. This pins that:
    // a future stroke-order or timing channel would have to be a deliberate change.
    for (const drawing of drawings.slice(0, 40)) {
      if (drawing.strokes.length < 2) {
        continue;
      }
      const reference = await predict(recognizer, drawing.strokes);
      const reversed = await predict(recognizer, [...drawing.strokes].reverse());
      expect(reversed.label).toBe(reference.label);
      expect(reversed.confidence).toBeCloseTo(reference.confidence, 5);
    }
  }, 120_000);

  it("is not thrown by extra sample points along the same path", async () => {
    // A player on a high-refresh pointer emits far more points than the dataset's
    // simplified strokes. Same shape, more samples, so the reading must not move.
    for (const drawing of drawings.slice(0, 30)) {
      const reference = await predict(recognizer, drawing.strokes);
      const dense = await predict(recognizer, drawing.strokes.map(subdivide));
      expect(dense.label).toBe(reference.label);
      expect(dense.confidence).toBeCloseTo(reference.confidence, 2);
    }
  }, 120_000);

  it("agrees with the unquantized model it was compressed from", async () => {
    // The 4.5 MB int8 build is what ships. If quantization ever starts changing
    // answers, this is where it shows up rather than in player complaints.
    let agreed = 0;
    for (const drawing of drawings) {
      const [a, b] = await Promise.all([
        predict(recognizer, drawing.strokes),
        predict(float32, drawing.strokes),
      ]);
      if (a.label === b.label) {
        agreed += 1;
      }
    }

    expect(agreed / drawings.length).toBeGreaterThan(0.97);
  }, 180_000);

  it("does not confidently name an empty or trivial scribble", async () => {
    // A stray dot or a single tick must not score a prompt for a player who has not
    // drawn anything yet.
    expect(rasterizeStrokes([])).toBeNull();

    for (const trivial of [[[{ x: 5, y: 5 }]], [[{ x: 0, y: 0 }, { x: 3, y: 0 }]]] as Stroke[][]) {
      const prediction = await predict(recognizer, trivial);
      expect(prediction.confidence).toBeLessThan(0.95);
    }
  });

  it("returns a proper probability distribution", async () => {
    for (const drawing of drawings.slice(0, 10)) {
      const scores = await recognizer.run(rasterizeStrokes(drawing.strokes)!);
      expect(scores).toHaveLength(345);

      let total = 0;
      for (const score of scores) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        total += score;
      }
      expect(total).toBeCloseTo(1, 3);
    }
  });

  it("labels its own dataset's words, not indices", async () => {
    const prediction = await predict(recognizer, drawings[0].strokes);
    expect(prediction.label).not.toMatch(/^class-\d+$/);
    expect(normalizeLabel(prediction.label)).toBe(prediction.label.toLowerCase().trim());
  });
});

async function predict(recognizer: NodeRecognizer, strokes: readonly Stroke[]) {
  const input = rasterizeStrokes(strokes);
  if (!input) {
    throw new Error("Strokes produced no ink.");
  }

  const scores = await recognizer.run(input);
  const [best] = rankTop(scores, 1);
  return { label: recognizer.classes[best], confidence: scores[best] };
}

/** Inserts a midpoint between every pair of points, doubling the sample rate. */
function subdivide(stroke: Stroke): Stroke {
  const dense = [];
  for (let index = 0; index < stroke.length; index += 1) {
    dense.push(stroke[index]);
    const next = stroke[index + 1];
    if (next) {
      dense.push({ x: (stroke[index].x + next.x) / 2, y: (stroke[index].y + next.y) / 2 });
    }
  }
  return dense;
}

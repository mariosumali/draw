import { describe, expect, it } from "vitest";

import { QUICK_DRAW_RASTER, rasterizeStrokes } from "@/lib/quickdraw/raster";
import { inkIoU, loadBitmapDrawings } from "../../../test/helpers/fixtures";

/**
 * Guards the single property the recognizer's accuracy rests on: that the strokes a
 * player draws are turned into the same kind of picture the model was trained on.
 *
 * Each fixture pairs a drawing with Google's own published 28x28 render of that exact
 * drawing. If someone changes the render size, the margin, the stroke weight or the
 * resampling filter, these numbers move and the suite says so - long before anyone has
 * to notice the game guessing badly.
 *
 * The bar is agreement, not equality. Google rendered with Pillow and we render with a
 * distance field, so individual antialiased pixels differ by design.
 */
describe("rasterizer parity with Google's published bitmaps", () => {
  const drawings = loadBitmapDrawings();

  it("has fixtures to compare against", () => {
    expect(drawings.length).toBeGreaterThanOrEqual(48);
    expect(drawings[0].bitmap).toHaveLength(
      QUICK_DRAW_RASTER.outputSize * QUICK_DRAW_RASTER.outputSize,
    );
  });

  it("reproduces the published bitmaps closely on average", () => {
    const scores = drawings.map((drawing) => inkIoU(rasterizeStrokes(drawing.strokes)!, drawing.bitmap));
    const mean = scores.reduce((total, score) => total + score, 0) / scores.length;

    expect(mean).toBeGreaterThan(0.85);
  });

  it("reproduces every individual drawing recognisably", () => {
    const poor = drawings
      .map((drawing) => ({
        word: drawing.word,
        keyId: drawing.keyId,
        iou: inkIoU(rasterizeStrokes(drawing.strokes)!, drawing.bitmap),
      }))
      .filter((entry) => entry.iou < 0.7);

    expect(poor).toEqual([]);
  });

  it("keeps per-pixel ink error small", () => {
    let error = 0;
    let count = 0;
    for (const drawing of drawings) {
      const raster = rasterizeStrokes(drawing.strokes)!;
      for (let index = 0; index < raster.length; index += 1) {
        error += Math.abs(raster[index] - drawing.bitmap[index]);
        count += 1;
      }
    }

    expect(error / count).toBeLessThan(0.05);
  });

  it("puts ink in the same total quantity as the published bitmaps", () => {
    for (const drawing of drawings) {
      const raster = rasterizeStrokes(drawing.strokes)!;
      const rendered = sum(raster);
      const published = sum(drawing.bitmap);
      // Within 25% is enough to catch a wrong stroke weight, which is the failure
      // mode that quietly destroys accuracy.
      expect(rendered).toBeGreaterThan(published * 0.75);
      expect(rendered).toBeLessThan(published * 1.25);
    }
  });
});

/**
 * Structural invariants of Google's own bitmaps, asserted against ours for the same
 * drawing rather than against magic numbers. These catch a render that is close enough
 * on average to pass an IoU check but is systematically shifted, mis-scaled, or drawn
 * at the wrong stroke weight.
 */
describe("rasterizer structural parity", () => {
  const drawings = loadBitmapDrawings();

  it("places ink over the same extent as the published bitmaps", () => {
    for (const drawing of drawings) {
      const rendered = inkExtent(rasterizeStrokes(drawing.strokes)!);
      const published = inkExtent(drawing.bitmap);
      expect(rendered).not.toBeNull();
      expect(published).not.toBeNull();

      expect(Math.abs(rendered!.width - published!.width), drawing.word).toBeLessThanOrEqual(2);
      expect(Math.abs(rendered!.height - published!.height), drawing.word).toBeLessThanOrEqual(2);
    }
  });

  it("centres the drawing, as the published bitmaps do", () => {
    for (const drawing of drawings) {
      const extent = inkExtent(rasterizeStrokes(drawing.strokes)!)!;
      const size = QUICK_DRAW_RASTER.outputSize;
      const horizontal = extent.minX - (size - 1 - extent.maxX);
      const vertical = extent.minY - (size - 1 - extent.maxY);

      expect(Math.abs(horizontal), `${drawing.word} is off-centre horizontally`).toBeLessThanOrEqual(2);
      expect(Math.abs(vertical), `${drawing.word} is off-centre vertically`).toBeLessThanOrEqual(2);
    }
  });

  it("reaches full ink, so the stroke is not rendered too thin to register", () => {
    for (const drawing of drawings) {
      expect(Math.max(...rasterizeStrokes(drawing.strokes)!), drawing.word).toBeGreaterThan(0.9);
    }
  });

  it("covers a similar fraction of the frame as the published bitmaps", () => {
    // Stroke weight is the failure mode here: too thin or too thick still centres and
    // still spans the right extent, but changes how much of the frame is inked.
    for (const drawing of drawings) {
      const rendered = inkFraction(rasterizeStrokes(drawing.strokes)!);
      const published = inkFraction(drawing.bitmap);
      expect(rendered, drawing.word).toBeGreaterThan(published * 0.7);
      expect(rendered, drawing.word).toBeLessThan(published * 1.35);
    }
  });
});

function inkExtent(values: Float32Array, threshold = 0.5) {
  const size: number = QUICK_DRAW_RASTER.outputSize;
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (values[y * size + x] > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return maxX < 0 ? null : { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function inkFraction(values: Float32Array, threshold = 0.5) {
  let inked = 0;
  for (const value of values) {
    if (value > threshold) {
      inked += 1;
    }
  }
  return inked / values.length;
}

function sum(values: Float32Array) {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

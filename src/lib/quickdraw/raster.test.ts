import { describe, expect, it } from "vitest";

import {
  getStrokeBounds,
  QUICK_DRAW_RASTER,
  rasterizeStrokes,
  resampleTriangle,
  type Stroke,
} from "@/lib/quickdraw/raster";
import { scaleStrokes, translateStrokes } from "../../../test/helpers/fixtures";

const { outputSize, renderSize, margin, lineWidth } = QUICK_DRAW_RASTER;

/** A recognisable asymmetric shape, so orientation bugs cannot hide. */
const HOUSE: Stroke[] = [
  [
    { x: 20, y: 90 },
    { x: 20, y: 40 },
    { x: 60, y: 10 },
    { x: 100, y: 40 },
    { x: 100, y: 90 },
    { x: 20, y: 90 },
  ],
  [
    { x: 50, y: 90 },
    { x: 50, y: 60 },
    { x: 70, y: 60 },
    { x: 70, y: 90 },
  ],
];

describe("getStrokeBounds", () => {
  it("returns null when no stroke carries a finite point", () => {
    expect(getStrokeBounds([])).toBeNull();
    expect(getStrokeBounds([[]])).toBeNull();
    expect(getStrokeBounds([[{ x: Number.NaN, y: 3 }]])).toBeNull();
  });

  it("spans every stroke", () => {
    expect(getStrokeBounds(HOUSE)).toEqual({ minX: 20, minY: 10, maxX: 100, maxY: 90 });
  });

  it("ignores non-finite points rather than poisoning the bounds", () => {
    const withNoise: Stroke[] = [
      [{ x: 1, y: 1 }, { x: Number.POSITIVE_INFINITY, y: 5 }, { x: 9, y: 7 }],
    ];
    expect(getStrokeBounds(withNoise)).toEqual({ minX: 1, minY: 1, maxX: 9, maxY: 7 });
  });
});

describe("rasterizeStrokes", () => {
  it("returns null for a drawing with nothing in it", () => {
    expect(rasterizeStrokes([])).toBeNull();
    expect(rasterizeStrokes([[]])).toBeNull();
  });

  it("produces a square ink map with values in [0, 1]", () => {
    const raster = rasterizeStrokes(HOUSE);
    expect(raster).not.toBeNull();
    expect(raster).toHaveLength(outputSize * outputSize);
    for (const value of raster!) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("actually inks the canvas", () => {
    const raster = rasterizeStrokes(HOUSE)!;
    const inked = [...raster].filter((value) => value > 0.5).length;
    expect(inked).toBeGreaterThan(20);
    expect(inked).toBeLessThan(raster.length * 0.6);
  });

  // Position and size independence is the whole point of rendering from strokes: a
  // player drawing small in a corner must be read the same as one drawing large and
  // centred. These are exact-equality checks, not approximations.
  it("is invariant to where on the surface the drawing was made", () => {
    const reference = rasterizeStrokes(HOUSE)!;
    for (const [dx, dy] of [
      [500, 300],
      [-40, 0],
      [0.5, -0.5],
    ]) {
      expect([...rasterizeStrokes(translateStrokes(HOUSE, dx, dy))!]).toEqual([...reference]);
    }
  });

  it("is invariant to how large the drawing was made", () => {
    const reference = rasterizeStrokes(HOUSE)!;
    for (const factor of [0.1, 3, 12]) {
      const scaled = [...rasterizeStrokes(scaleStrokes(HOUSE, factor))!];
      for (let index = 0; index < scaled.length; index += 1) {
        expect(scaled[index]).toBeCloseTo(reference[index], 5);
      }
    }
  });

  it("keeps the margin Google's bitmaps were rendered with", () => {
    const raster = rasterizeStrokes(HOUSE)!;
    // Strokes are centred on the path, so ink reaches half a line width past the
    // stroke bounding box. What must stay blank is the margin minus that overhang.
    const border = Math.floor(((margin - lineWidth / 2) * outputSize) / renderSize);
    expect(border).toBeGreaterThan(0);

    for (let y = 0; y < outputSize; y += 1) {
      for (let x = 0; x < outputSize; x += 1) {
        const isBorder = x < border || y < border || x >= outputSize - border || y >= outputSize - border;
        if (isBorder) {
          // Antialiasing bleeds a trace into the border; nothing readable may sit there.
          expect(raster[y * outputSize + x]).toBeLessThan(0.01);
        }
      }
    }
  });

  it("preserves aspect ratio instead of stretching to fill", () => {
    const wide: Stroke[] = [[{ x: 0, y: 0 }, { x: 200, y: 0 }]];
    const raster = rasterizeStrokes(wide)!;

    const rowsWithInk = new Set<number>();
    const columnsWithInk = new Set<number>();
    for (let y = 0; y < outputSize; y += 1) {
      for (let x = 0; x < outputSize; x += 1) {
        if (raster[y * outputSize + x] > 0.5) {
          rowsWithInk.add(y);
          columnsWithInk.add(x);
        }
      }
    }

    expect(columnsWithInk.size).toBeGreaterThan(rowsWithInk.size * 3);
  });

  it("renders a lone point as a centred dot rather than dropping it", () => {
    // A single point has no extent, so there is no meaningful scale to fit it to.
    // It must still land in the middle of the frame instead of off-canvas.
    const raster = rasterizeStrokes([[{ x: 5, y: 5 }]])!;
    const peak = Math.max(...raster);
    expect(peak).toBeGreaterThan(0.3);

    const peakIndex = [...raster].indexOf(peak);
    expect(Math.abs((peakIndex % outputSize) - outputSize / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(Math.floor(peakIndex / outputSize) - outputSize / 2)).toBeLessThanOrEqual(1);
  });

  it("does not let overlapping strokes read darker than a single stroke", () => {
    const line: Stroke[] = [[{ x: 0, y: 0 }, { x: 100, y: 100 }]];
    const doubled: Stroke[] = [...line, ...line, ...line];
    expect([...rasterizeStrokes(doubled)!]).toEqual([...rasterizeStrokes(line)!]);
  });

  it("is deterministic", () => {
    expect([...rasterizeStrokes(HOUSE)!]).toEqual([...rasterizeStrokes(HOUSE)!]);
  });

  it("honours explicit render options", () => {
    const raster = rasterizeStrokes(HOUSE, { outputSize: 64 });
    expect(raster).toHaveLength(64 * 64);
  });
});

describe("resampleTriangle", () => {
  it("returns a copy when the size is unchanged", () => {
    const source = Float32Array.from([0, 0.5, 1, 0.25]);
    const resampled = resampleTriangle(source, 2, 2, 2, 2);
    expect([...resampled]).toEqual([...source]);
    expect(resampled).not.toBe(source);
  });

  it("preserves a uniform field exactly when shrinking", () => {
    const source = new Float32Array(16).fill(0.75);
    for (const value of resampleTriangle(source, 4, 4, 2, 2)) {
      expect(value).toBeCloseTo(0.75, 6);
    }
  });

  it("blends neighbouring cells rather than point-sampling them", () => {
    // A 2x2 checkerboard of 2x2 blocks. A box filter would return the block values
    // unchanged; the triangle filter's wider support pulls each output toward its
    // neighbours, which is what reproduces Google's bitmaps.
    const source = Float32Array.from([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
    const resampled = resampleTriangle(source, 4, 4, 2, 2);
    expect(resampled[0]).toBeGreaterThan(0.7);
    expect(resampled[0]).toBeLessThan(1);
    expect(resampled[1]).toBeCloseTo(1 - resampled[0], 5);
    expect(resampled[0] + resampled[1] + resampled[2] + resampled[3]).toBeCloseTo(2, 5);
  });

  it("keeps values inside the source range", () => {
    const source = new Float32Array(64).fill(0.3);
    for (const value of resampleTriangle(source, 8, 8, 3, 5)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0.3 + 1e-6);
    }
  });
});

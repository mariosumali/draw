import { describe, expect, it } from "vitest";

import { canvasToQuickDrawInput, getInkBounds } from "@/lib/quickdraw/preprocess";
import { QUICK_DRAW_RASTER } from "@/lib/quickdraw/raster";

const { outputSize } = QUICK_DRAW_RASTER;

describe("getInkBounds", () => {
  it("returns null when the image is blank", () => {
    expect(getInkBounds(whiteImage(4, 4), 4, 4)).toBeNull();
  });

  it("finds the bounds of dark ink", () => {
    const data = whiteImage(5, 5);
    paintBlack(data, 5, 1, 2);
    paintBlack(data, 5, 3, 4);

    expect(getInkBounds(data, 5, 5)).toEqual({ minX: 1, minY: 2, maxX: 3, maxY: 4 });
  });

  it("ignores ink too faint to read", () => {
    const data = whiteImage(4, 4);
    paintGray(data, 4, 1, 1, 250);
    expect(getInkBounds(data, 4, 4)).toBeNull();
  });

  it("treats transparent pixels as blank paper", () => {
    const data = whiteImage(4, 4);
    const offset = (1 * 4 + 1) * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;

    expect(getInkBounds(data, 4, 4)).toBeNull();
  });
});

/**
 * The pixel path is a fallback for surfaces that do not keep their strokes. It cannot
 * recover stroke weight, but it must still normalise position and scale - otherwise a
 * drawing made in the corner reads differently from the same drawing made in the
 * middle, which is what the old implementation did.
 */
describe("canvasToQuickDrawInput", () => {
  it("returns null for a blank canvas", () => {
    expect(canvasToQuickDrawInput(fakeCanvas(40, 40, () => false))).toBeNull();
  });

  it("produces a square ink map with ink at 1 and paper at 0", () => {
    const input = canvasToQuickDrawInput(fakeCanvas(40, 40, (x, y) => x >= 10 && x < 30 && y === 20))!;

    expect(input).toHaveLength(outputSize * outputSize);
    expect(Math.max(...input)).toBeCloseTo(1, 1);
    expect(Math.min(...input)).toBe(0);
  });

  it("inverts when asked for luminance polarity", () => {
    const box = (x: number, y: number) => x >= 10 && x < 30 && y >= 10 && y < 30;
    const ink = canvasToQuickDrawInput(fakeCanvas(40, 40, box))!;
    const luminance = canvasToQuickDrawInput(fakeCanvas(40, 40, box), { polarity: "luminance" })!;

    for (let index = 0; index < ink.length; index += 1) {
      expect(luminance[index]).toBeCloseTo(1 - ink[index], 5);
    }
  });

  it("reads the same drawing the same wherever it was placed", () => {
    const shape = (offsetX: number, offsetY: number) => (x: number, y: number) => {
      const localX = x - offsetX;
      const localY = y - offsetY;
      return localX >= 0 && localX < 12 && localY >= 0 && localY < 8 && (localY === 0 || localX === 0);
    };

    const topLeft = canvasToQuickDrawInput(fakeCanvas(60, 60, shape(2, 2)))!;
    const bottomRight = canvasToQuickDrawInput(fakeCanvas(60, 60, shape(40, 45)))!;

    expect([...bottomRight]).toEqual([...topLeft]);
  });

  it("keeps the drawing inside the margin", () => {
    const input = canvasToQuickDrawInput(fakeCanvas(60, 60, (x, y) => x >= 1 && x < 59 && y >= 1 && y < 59))!;
    for (let index = 0; index < outputSize; index += 1) {
      expect(input[index]).toBe(0);
      expect(input[input.length - 1 - index]).toBe(0);
    }
  });
});

function whiteImage(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
  return data;
}

function paintBlack(data: Uint8ClampedArray, width: number, x: number, y: number) {
  paintGray(data, width, x, y, 0);
}

function paintGray(data: Uint8ClampedArray, width: number, x: number, y: number, value: number) {
  const offset = (y * width + x) * 4;
  data[offset] = value;
  data[offset + 1] = value;
  data[offset + 2] = value;
  data[offset + 3] = 255;
}

/** jsdom has no 2D context, so the tests supply the pixels the code would have read. */
function fakeCanvas(width: number, height: number, isInk: (x: number, y: number) => boolean) {
  const data = whiteImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isInk(x, y)) {
        paintBlack(data, width, x, y);
      }
    }
  }

  return {
    width,
    height,
    getContext: () => ({ getImageData: () => ({ data, width, height }) }),
  } as unknown as HTMLCanvasElement;
}

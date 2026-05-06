import { describe, expect, it } from "vitest";

import { getInkBounds } from "@/lib/quickdraw/preprocess";

describe("getInkBounds", () => {
  it("returns null when the image is blank", () => {
    const data = whiteImage(4, 4);
    expect(getInkBounds(data, 4, 4)).toBeNull();
  });

  it("finds the bounds of dark ink", () => {
    const data = whiteImage(5, 5);
    paintBlack(data, 5, 1, 2);
    paintBlack(data, 5, 3, 4);

    expect(getInkBounds(data, 5, 5)).toEqual({
      minX: 1,
      minY: 2,
      maxX: 3,
      maxY: 4,
    });
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
  const offset = (y * width + x) * 4;
  data[offset] = 0;
  data[offset + 1] = 0;
  data[offset + 2] = 0;
  data[offset + 3] = 255;
}

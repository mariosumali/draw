import { QUICK_DRAW_RASTER, resampleTriangle } from "@/lib/quickdraw/raster";

export type InkBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type QuickDrawTensorOptions = {
  polarity?: "ink" | "luminance";
};

const INK_THRESHOLD = 0.08;

export function getInkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): InkBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inkAt(data, (y * width + x) * 4) > INK_THRESHOLD) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Builds a model input from canvas pixels.
 *
 * This is the fallback for surfaces that do not retain their strokes. It normalises
 * position and scale the same way the stroke path does - crop to the ink, fit into the
 * same inner box, keep the same margin - so a drawing is recognised wherever on the
 * canvas it was made. What it cannot recover is stroke weight: the training bitmaps
 * were stroked at 12.8/216 of the drawing's long edge, and a canvas drawn with a
 * thinner or thicker pen lands outside that distribution. Prefer `classifyStrokes`.
 *
 * Returns ink-major values in `[0, 1]`, or `null` when the canvas is blank.
 */
export function canvasToQuickDrawInput(
  canvas: HTMLCanvasElement,
  options: QuickDrawTensorOptions = {},
): Float32Array | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = getInkBounds(image.data, canvas.width, canvas.height);
  if (!bounds) {
    return null;
  }

  const inkWidth = bounds.maxX - bounds.minX + 1;
  const inkHeight = bounds.maxY - bounds.minY + 1;
  const cropped = new Float32Array(inkWidth * inkHeight);
  for (let y = 0; y < inkHeight; y += 1) {
    for (let x = 0; x < inkWidth; x += 1) {
      const offset = ((bounds.minY + y) * canvas.width + (bounds.minX + x)) * 4;
      cropped[y * inkWidth + x] = inkAt(image.data, offset);
    }
  }

  const { outputSize, renderSize, margin } = QUICK_DRAW_RASTER;
  const inner = (outputSize * (renderSize - margin * 2)) / renderSize;
  const scale = inner / Math.max(inkWidth, inkHeight);
  const targetWidth = Math.max(1, Math.round(inkWidth * scale));
  const targetHeight = Math.max(1, Math.round(inkHeight * scale));
  const scaled = resampleTriangle(cropped, inkWidth, inkHeight, targetWidth, targetHeight);

  const output = new Float32Array(outputSize * outputSize);
  const offsetX = Math.round((outputSize - targetWidth) / 2);
  const offsetY = Math.round((outputSize - targetHeight) / 2);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      output[(offsetY + y) * outputSize + (offsetX + x)] = scaled[y * targetWidth + x];
    }
  }

  if (options.polarity === "luminance") {
    for (let index = 0; index < output.length; index += 1) {
      output[index] = 1 - output[index];
    }
  }

  return output;
}

/** Renders the inked region of a canvas into a square canvas, for image-input models. */
export function cropCanvasToInk(
  canvas: HTMLCanvasElement,
  size: number = QUICK_DRAW_RASTER.outputSize,
): HTMLCanvasElement | null {
  const sourceContext = canvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    return null;
  }

  const sourceImage = sourceContext.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = getInkBounds(sourceImage.data, canvas.width, canvas.height);
  if (!bounds) {
    return null;
  }

  const crop = squareCrop(bounds, canvas.width, canvas.height);
  const cropped = document.createElement("canvas");
  cropped.width = size;
  cropped.height = size;

  const context = cropped.getContext("2d");
  if (!context) {
    return null;
  }

  context.fillStyle = "white";
  context.fillRect(0, 0, size, size);
  context.drawImage(canvas, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
  return cropped;
}

/** How much ink covers a pixel, from 0 (blank paper) to 1 (fully inked). */
function inkAt(data: Uint8ClampedArray, offset: number) {
  const alpha = data[offset + 3] / 255;
  const luminance = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
  return alpha * ((255 - luminance) / 255);
}

function squareCrop(bounds: InkBounds, width: number, height: number) {
  const inkWidth = bounds.maxX - bounds.minX + 1;
  const inkHeight = bounds.maxY - bounds.minY + 1;
  const paddedSize = Math.max(inkWidth, inkHeight) * 1.35;
  const size = Math.min(Math.max(paddedSize, 32), Math.max(width, height));
  const centerX = bounds.minX + inkWidth / 2;
  const centerY = bounds.minY + inkHeight / 2;

  return {
    x: clamp(centerX - size / 2, 0, width - size),
    y: clamp(centerY - size / 2, 0, height - size),
    size,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

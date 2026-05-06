import * as tf from "@tensorflow/tfjs";

export type InkBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const MODEL_SIZE = 28;

export function getInkBounds(data: Uint8ClampedArray, width: number, height: number): InkBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] / 255;
      const luminance = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      const darkness = (255 - luminance) / 255;

      if (alpha * darkness > 0.08) {
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

export function canvasToQuickDrawTensor(canvas: HTMLCanvasElement) {
  const sourceContext = canvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const sourceImage = sourceContext.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = getInkBounds(sourceImage.data, canvas.width, canvas.height);
  if (!bounds) {
    return null;
  }

  const crop = squareCrop(bounds, canvas.width, canvas.height);
  const normalizedCanvas = document.createElement("canvas");
  normalizedCanvas.width = MODEL_SIZE;
  normalizedCanvas.height = MODEL_SIZE;

  const normalizedContext = normalizedCanvas.getContext("2d", { willReadFrequently: true });
  if (!normalizedContext) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  normalizedContext.fillStyle = "white";
  normalizedContext.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);
  normalizedContext.drawImage(
    canvas,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    MODEL_SIZE,
    MODEL_SIZE,
  );

  const normalizedImage = normalizedContext.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
  const values = new Float32Array(MODEL_SIZE * MODEL_SIZE);

  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    const luminance =
      normalizedImage.data[offset] * 0.299 +
      normalizedImage.data[offset + 1] * 0.587 +
      normalizedImage.data[offset + 2] * 0.114;
    values[index] = (255 - luminance) / 255;
  }

  return tf.tensor4d(values, [1, MODEL_SIZE, MODEL_SIZE, 1]);
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

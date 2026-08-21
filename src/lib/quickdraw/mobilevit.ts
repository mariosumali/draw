"use client";

import { getInkBounds } from "@/lib/quickdraw/preprocess";
import type { Prediction } from "@/lib/game/types";

const MOBILEVIT_MODEL_ID = "Xenova/quickdraw-mobilevit-small";
const MODEL_SIZE = 28;
const TOP_PREDICTION_COUNT = 5;

type ImageClassificationResult = {
  label: string;
  score: number;
};

type ImageClassifier = (
  image: unknown,
  options?: { top_k?: number },
) => Promise<ImageClassificationResult[]>;

let classifierPromise: Promise<ImageClassifier> | undefined;

export function loadMobileViTModel() {
  classifierPromise ??= loadClassifier();
  return classifierPromise;
}

export async function classifyCanvasWithMobileViT(canvas: HTMLCanvasElement): Promise<Prediction[]> {
  const normalizedCanvas = canvasToMobileViTCanvas(canvas);
  if (!normalizedCanvas) {
    return [];
  }

  const [{ RawImage }, classifier] = await Promise.all([
    import("@huggingface/transformers"),
    loadMobileViTModel(),
  ]);
  const image = RawImage.fromCanvas(normalizedCanvas).grayscale();
  const results = await classifier(image, { top_k: TOP_PREDICTION_COUNT });

  return results.map((result) => ({
    label: result.label,
    confidence: result.score,
  }));
}

async function loadClassifier() {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowLocalModels = false;

  return pipeline("image-classification", MOBILEVIT_MODEL_ID, {
    dtype: "q8",
  }) as Promise<ImageClassifier>;
}

function canvasToMobileViTCanvas(canvas: HTMLCanvasElement) {
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

  return normalizedCanvas;
}

function squareCrop(bounds: NonNullable<ReturnType<typeof getInkBounds>>, width: number, height: number) {
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

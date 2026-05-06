"use client";

import * as tf from "@tensorflow/tfjs";

import type { Prediction } from "@/lib/game/types";
import { canvasToQuickDrawTensor } from "@/lib/quickdraw/preprocess";

const MODEL_URL = "/models/quickdraw/model.json";
const CLASSES_URL = "/models/quickdraw/classes.json";

type ModelBundle = {
  model: tf.LayersModel;
  classes: string[];
};

let modelPromise: Promise<ModelBundle> | undefined;

export class QuickDrawModelAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickDrawModelAssetError";
  }
}

export async function loadQuickDrawModel() {
  modelPromise ??= loadModelBundle();
  return modelPromise;
}

export async function classifyCanvas(canvas: HTMLCanvasElement): Promise<Prediction[]> {
  const bundle = await loadQuickDrawModel();
  const input = canvasToQuickDrawTensor(canvas);

  if (!input) {
    return [];
  }

  const predictionTensor = tf.tidy(() => {
    const output = bundle.model.predict(input);
    return Array.isArray(output) ? output[0].clone() : output.clone();
  });

  input.dispose();

  const scores = await predictionTensor.data();
  predictionTensor.dispose();

  return [...scores]
    .map((confidence, index) => ({
      label: bundle.classes[index] ?? `class-${index}`,
      confidence,
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

async function loadModelBundle(): Promise<ModelBundle> {
  try {
    await tf.ready();
    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));

    const [model, classes] = await Promise.all([
      tf.loadLayersModel(MODEL_URL),
      fetchClasses(),
    ]);

    return { model, classes };
  } catch (error) {
    throw new QuickDrawModelAssetError(
      `Quick Draw model assets are missing or invalid. Add a TensorFlow.js model at ${MODEL_URL} and labels at ${CLASSES_URL}. Original error: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

async function fetchClasses() {
  const response = await fetch(CLASSES_URL);
  if (!response.ok) {
    throw new Error(`Unable to load class labels from ${CLASSES_URL}.`);
  }

  const labels = (await response.json()) as unknown;
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")) {
    throw new Error("Class labels must be a JSON array of strings.");
  }

  return labels;
}

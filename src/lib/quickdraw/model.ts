"use client";

import * as tf from "@tensorflow/tfjs";

import type { Prediction } from "@/lib/game/types";
import { calibrateQuickDrawPredictions } from "@/lib/quickdraw/calibrate";
import { rankTop } from "@/lib/quickdraw/evaluation";
import { classifyCanvasWithMl5DoodleNet, loadMl5DoodleNet } from "@/lib/quickdraw/ml5-doodlenet";
import { createOnnxSession, type OnnxSession } from "@/lib/quickdraw/onnx";
import { canvasToQuickDrawInput } from "@/lib/quickdraw/preprocess";
import { rasterizeStrokes, type Stroke } from "@/lib/quickdraw/raster";

export { calibrateQuickDrawPredictions } from "@/lib/quickdraw/calibrate";

const ONNX_MODEL_URL = "/models/quickdraw-onnx/quickdraw_int8.onnx";
const ONNX_CLASSES_URL = "/models/quickdraw-onnx/classes.json";
const QUICKDRAW_MODEL_URL = "/models/quickdraw/model.json";
const QUICKDRAW_CLASSES_URL = "/models/quickdraw/classes.json";
const LAYERS_MODEL_URL = "/models/doodlenet/model.json";
const LAYERS_CLASSES_URL = "/models/doodlenet/classes.json";
const TOP_PREDICTION_COUNT = 5;

export type QuickDrawModelId = "quickdraw-onnx" | "ml5-doodlenet" | "quickdraw-local" | "doodlenet";

export type QuickDrawModelDescriptor = {
  id: QuickDrawModelId;
  name: string;
  summary: string;
  modelUrl: string;
  classesUrl: string;
  metadataUrl: string;
  backend: "onnx" | "ml5" | "layers";
  /**
   * How pixel values map to model inputs. `ink` means an inked pixel is 1 and blank
   * paper is 0; `luminance` is the inverse. Getting this backwards silently costs
   * essentially all accuracy, so it is verified in `model.accuracy.test.ts`.
   */
  inputPolarity: "ink" | "luminance";
};

type ModelBundle = {
  classes: string[];
  run: (input: Float32Array) => Promise<Float32Array>;
};

export const DEFAULT_QUICK_DRAW_MODEL_ID: QuickDrawModelId = "quickdraw-onnx";

export const QUICK_DRAW_MODELS: QuickDrawModelDescriptor[] = [
  {
    id: "quickdraw-onnx",
    name: "QuickDraw SE-ResNet (ONNX)",
    summary:
      "SE-ResNet over all 345 Quick Draw categories, run in-browser through ONNX Runtime Web. 80.3% top-1 / 93.7% top-3 on held-out drawings.",
    modelUrl: ONNX_MODEL_URL,
    classesUrl: ONNX_CLASSES_URL,
    metadataUrl: "/models/quickdraw-onnx/model-metadata.json",
    backend: "onnx",
    inputPolarity: "ink",
  },
  {
    id: "ml5-doodlenet",
    name: "DoodleNet (ml5.js)",
    summary:
      "Google Creative Lab DoodleNet via ml5.js - 345 Quick Draw categories, loaded from the ml5 CDN.",
    modelUrl: "https://unpkg.com/ml5@1.3.1/dist/ml5.min.js",
    classesUrl: "/models/quickdraw-categories/categories.json",
    metadataUrl: "/models/quickdraw-categories/categories.json",
    backend: "ml5",
    inputPolarity: "ink",
  },
  {
    id: "quickdraw-local",
    name: "QuickDraw TF.js",
    summary: "Locally trained TensorFlow.js model from the Google QuickDraw numpy bitmap dataset.",
    modelUrl: QUICKDRAW_MODEL_URL,
    classesUrl: QUICKDRAW_CLASSES_URL,
    metadataUrl: "/models/quickdraw/model-metadata.json",
    backend: "layers",
    inputPolarity: "ink",
  },
  {
    id: "doodlenet",
    name: "DoodleNet (local weights)",
    summary: "Pretrained DoodleNet TensorFlow.js model for the 345-class QuickDraw label set.",
    modelUrl: LAYERS_MODEL_URL,
    classesUrl: LAYERS_CLASSES_URL,
    metadataUrl: "/models/doodlenet/model-metadata.json",
    backend: "layers",
    inputPolarity: "ink",
  },
];

const modelPromises = new Map<QuickDrawModelId, Promise<ModelBundle>>();

export class QuickDrawModelAssetError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "QuickDrawModelAssetError";
  }
}

export function getQuickDrawModelDescriptor(modelId: QuickDrawModelId) {
  return QUICK_DRAW_MODELS.find((model) => model.id === modelId) ?? QUICK_DRAW_MODELS[0];
}

export async function loadQuickDrawModel(
  modelId: QuickDrawModelId = DEFAULT_QUICK_DRAW_MODEL_ID,
): Promise<ModelBundle | void> {
  if (modelId === "ml5-doodlenet") {
    await loadMl5DoodleNet();
    return;
  }

  const descriptor = getQuickDrawModelDescriptor(modelId);
  const existingPromise = modelPromises.get(descriptor.id);
  if (existingPromise) {
    return existingPromise;
  }

  const nextPromise = loadModelBundle(descriptor).catch((error) => {
    modelPromises.delete(descriptor.id);
    throw error;
  });
  modelPromises.set(descriptor.id, nextPromise);
  return nextPromise;
}

/**
 * Classifies a drawing from its strokes.
 *
 * This is the accurate path and the one the game uses. Strokes are re-rendered at the
 * scale and stroke weight the training bitmaps were drawn at, which makes recognition
 * independent of how large the player drew or where on the canvas they drew it.
 */
export async function classifyStrokes(
  strokes: readonly Stroke[],
  options: { modelId?: QuickDrawModelId } = {},
): Promise<Prediction[]> {
  const modelId = options.modelId ?? DEFAULT_QUICK_DRAW_MODEL_ID;
  const descriptor = getQuickDrawModelDescriptor(modelId);

  if (descriptor.backend === "ml5") {
    throw new QuickDrawModelAssetError(
      "The ml5 DoodleNet backend classifies pixels, not strokes. Use classifyCanvas instead.",
    );
  }

  const input = rasterizeStrokes(strokes);
  if (!input) {
    return [];
  }

  const bundle = await loadQuickDrawModel(modelId);
  if (!bundle) {
    throw new QuickDrawModelAssetError("Quick Draw model bundle is unavailable.");
  }

  return toPredictions(await bundle.run(applyPolarity(input, descriptor.inputPolarity)), bundle.classes);
}

/**
 * Classifies a drawing from canvas pixels.
 *
 * Downscaling a large canvas to 28x28 loses most of the stroke detail the model was
 * trained on, so this is only used where strokes are genuinely unavailable, and for
 * the ml5 backend which takes an image. Prefer {@link classifyStrokes}.
 */
export async function classifyCanvas(
  canvas: HTMLCanvasElement,
  options: { modelId?: QuickDrawModelId } = {},
): Promise<Prediction[]> {
  const modelId = options.modelId ?? DEFAULT_QUICK_DRAW_MODEL_ID;
  if (modelId === "ml5-doodlenet") {
    return classifyCanvasWithMl5DoodleNet(canvas);
  }

  const descriptor = getQuickDrawModelDescriptor(modelId);
  const input = canvasToQuickDrawInput(canvas, { polarity: descriptor.inputPolarity });
  if (!input) {
    return [];
  }

  const bundle = await loadQuickDrawModel(modelId);
  if (!bundle) {
    throw new QuickDrawModelAssetError("Quick Draw model bundle is unavailable.");
  }

  return toPredictions(await bundle.run(input), bundle.classes);
}

function toPredictions(scores: Float32Array, classes: string[]): Prediction[] {
  const predictions = rankTop(scores, TOP_PREDICTION_COUNT).map((index) => ({
    label: classes[index] ?? `class-${index}`,
    confidence: scores[index],
  }));

  return calibrateQuickDrawPredictions(predictions).sort(
    (left, right) => right.confidence - left.confidence,
  );
}

function applyPolarity(input: Float32Array, polarity: "ink" | "luminance") {
  if (polarity === "ink") {
    return input;
  }

  const inverted = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    inverted[index] = 1 - input[index];
  }
  return inverted;
}

async function loadModelBundle(descriptor: QuickDrawModelDescriptor): Promise<ModelBundle> {
  try {
    if (descriptor.backend === "onnx") {
      const [session, classes] = await Promise.all([
        createOnnxSession(descriptor.modelUrl),
        fetchClasses(descriptor.classesUrl),
      ]);
      return { classes, run: (input) => runOnnx(session, input) };
    }

    await tf.ready();
    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));

    const [model, classes] = await Promise.all([
      tf.loadLayersModel(descriptor.modelUrl),
      fetchClasses(descriptor.classesUrl),
    ]);

    return { classes, run: async (input) => runLayers(model, input) };
  } catch (error) {
    throw new QuickDrawModelAssetError(
      `Quick Draw model assets are missing or invalid for ${descriptor.name}. ` +
        `Expected the model at ${descriptor.modelUrl} and labels at ${descriptor.classesUrl}.`,
      { cause: error },
    );
  }
}

function runOnnx(session: OnnxSession, input: Float32Array) {
  return session.run(input);
}

async function runLayers(model: tf.LayersModel, input: Float32Array) {
  const size = Math.round(Math.sqrt(input.length));
  const tensor = tf.tensor4d(input, [1, size, size, 1]);
  const output = tf.tidy(() => {
    const prediction = model.predict(tensor);
    if (Array.isArray(prediction)) {
      return prediction[0].clone();
    }
    return prediction.clone();
  });

  tensor.dispose();
  const scores = (await output.data()) as Float32Array;
  output.dispose();
  return scores;
}

async function fetchClasses(classesUrl: string) {
  const response = await fetch(classesUrl);
  if (!response.ok) {
    throw new Error(`Unable to load class labels from ${classesUrl}.`);
  }

  const labels = (await response.json()) as unknown;
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")) {
    throw new Error("Class labels must be a JSON array of strings.");
  }

  return labels;
}

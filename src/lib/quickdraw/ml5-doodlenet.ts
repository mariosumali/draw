"use client";

import { calibrateQuickDrawPredictions } from "@/lib/quickdraw/calibrate";
import { cropCanvasToInk } from "@/lib/quickdraw/preprocess";
import type { Prediction } from "@/lib/game/types";

const ML5_SCRIPT_URL = "https://unpkg.com/ml5@1.3.1/dist/ml5.min.js";
const TOP_PREDICTION_COUNT = 5;

type Ml5ImageClassifier = {
  classify: (
    input: HTMLCanvasElement | HTMLImageElement | string,
    callbackOrCount: number | Ml5ClassifyCallback,
    callback?: Ml5ClassifyCallback,
  ) => void;
};

type Ml5ClassifyCallback = (error: Error | null, results: Ml5ClassificationResult[]) => void;

type Ml5ClassificationResult = {
  label: string;
  confidence: number;
};

type Ml5Namespace = {
  imageClassifier: (modelName: "DoodleNet", callback: () => void) => Ml5ImageClassifier;
};

let ml5ScriptPromise: Promise<Ml5Namespace> | undefined;
let doodleNetPromise: Promise<Ml5ImageClassifier> | undefined;

export class Ml5DoodleNetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Ml5DoodleNetError";
  }
}

export async function loadMl5DoodleNet() {
  doodleNetPromise ??= createDoodleNetClassifier();
  return doodleNetPromise;
}

export async function classifyCanvasWithMl5DoodleNet(canvas: HTMLCanvasElement): Promise<Prediction[]> {
  const classifier = await loadMl5DoodleNet();
  const cropped = cropCanvasToInk(canvas, 280);
  if (!cropped) {
    return [];
  }
  const results = await classifyWithMl5(classifier, cropped, TOP_PREDICTION_COUNT);
  const predictions = results.map((result) => ({
    label: result.label,
    confidence: result.confidence,
  }));

  return calibrateQuickDrawPredictions(predictions)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, TOP_PREDICTION_COUNT);
}

function createDoodleNetClassifier() {
  return loadMl5Runtime().then(
    (ml5) =>
      new Promise<Ml5ImageClassifier>((resolve, reject) => {
        try {
          const classifier = ml5.imageClassifier("DoodleNet", () => resolve(classifier));
        } catch (error) {
          reject(
            new Ml5DoodleNetError(
              error instanceof Error ? error.message : "Unable to initialize the ml5 DoodleNet classifier.",
            ),
          );
        }
      }),
  );
}

function loadMl5Runtime() {
  ml5ScriptPromise ??= new Promise<Ml5Namespace>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Ml5DoodleNetError("ml5.js can only run in the browser."));
      return;
    }

    const existingMl5 = (window as Window & { ml5?: Ml5Namespace }).ml5;
    if (existingMl5) {
      resolve(existingMl5);
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-ml5-runtime="true"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        const loadedMl5 = (window as Window & { ml5?: Ml5Namespace }).ml5;
        if (!loadedMl5) {
          reject(new Ml5DoodleNetError("ml5.js loaded but did not expose a global `ml5` object."));
          return;
        }
        resolve(loadedMl5);
      });
      existingScript.addEventListener("error", () => {
        reject(new Ml5DoodleNetError(`Unable to load ml5.js from ${ML5_SCRIPT_URL}.`));
      });
      return;
    }

    const script = document.createElement("script");
    script.src = ML5_SCRIPT_URL;
    script.async = true;
    script.dataset.ml5Runtime = "true";
    script.onload = () => {
      const loadedMl5 = (window as Window & { ml5?: Ml5Namespace }).ml5;
      if (!loadedMl5) {
        reject(new Ml5DoodleNetError("ml5.js loaded but did not expose a global `ml5` object."));
        return;
      }
      resolve(loadedMl5);
    };
    script.onerror = () => {
      reject(new Ml5DoodleNetError(`Unable to load ml5.js from ${ML5_SCRIPT_URL}.`));
    };
    document.head.appendChild(script);
  });

  return ml5ScriptPromise;
}

function classifyWithMl5(classifier: Ml5ImageClassifier, canvas: HTMLCanvasElement, count: number) {
  return new Promise<Ml5ClassificationResult[]>((resolve, reject) => {
    classifier.classify(canvas, count, (error, results) => {
      if (error) {
        reject(new Ml5DoodleNetError(error.message));
        return;
      }

      resolve(results);
    });
  });
}

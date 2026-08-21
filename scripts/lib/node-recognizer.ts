import { readFile } from "node:fs/promises";
import { join } from "node:path";

import * as ort from "onnxruntime-node";

import { QUICK_DRAW_RASTER } from "@/lib/quickdraw/raster";
import type { ScoreRunner } from "@/lib/quickdraw/evaluation";

export type NodeRecognizerVariant = "float32" | "int8";

export const MODEL_DIR = join(process.cwd(), "public/models/quickdraw-onnx");

const MODEL_FILES: Record<NodeRecognizerVariant, string> = {
  float32: "quickdraw.onnx",
  int8: "quickdraw_int8.onnx",
};

export type NodeRecognizer = {
  classes: string[];
  run: ScoreRunner;
  release: () => Promise<void>;
};

/**
 * Loads the shipped ONNX recognizer under Node.
 *
 * This is the same graph and the same weights the browser loads through
 * `onnxruntime-web`, which is what lets the accuracy suite make claims about the
 * model the game actually serves.
 */
export async function loadNodeRecognizer(
  variant: NodeRecognizerVariant = "float32",
  dir = MODEL_DIR,
): Promise<NodeRecognizer> {
  const [session, classes] = await Promise.all([
    ort.InferenceSession.create(join(dir, MODEL_FILES[variant]), {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    }),
    readFile(join(dir, "classes.json"), "utf8").then((raw) => JSON.parse(raw) as string[]),
  ]);

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const { outputSize } = QUICK_DRAW_RASTER;

  return {
    classes,
    async run(input: Float32Array) {
      const tensor = new ort.Tensor("float32", input, [1, outputSize, outputSize, 1]);
      const output = await session.run({ [inputName]: tensor });
      return output[outputName].data as Float32Array;
    },
    async release() {
      await session.release();
    },
  };
}

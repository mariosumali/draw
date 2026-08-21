"use client";

import { QUICK_DRAW_RASTER } from "@/lib/quickdraw/raster";

/**
 * Browser-side ONNX Runtime session management for the Quick Draw recognizer.
 *
 * The WASM binary is served from `public/ort` rather than a CDN so the game keeps
 * working offline and on locked-down networks. Threading is left off: it would
 * require cross-origin isolation headers, and a 28x28 CNN scores in well under a
 * millisecond single-threaded.
 */

const ORT_WASM_PATH = "/ort/";

export type OnnxSession = {
  run: (input: Float32Array) => Promise<Float32Array>;
};

export class QuickDrawOnnxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "QuickDrawOnnxError";
  }
}

// The `/wasm` entry, not the default one. The default entry pulls the `.jsep` build
// for WebGPU, which is twice the download and needs a different pair of binaries in
// public/ort. This model is a 28x28 CNN, so plain WASM is already far faster than the
// 450ms the game classifies at. `scripts/sync-ort-assets.ts` copies the matching
// binaries; keep the two in step.
let runtimePromise: Promise<typeof import("onnxruntime-web/wasm")> | undefined;

async function loadRuntime() {
  runtimePromise ??= import("onnxruntime-web/wasm").then((ort) => {
    ort.env.wasm.wasmPaths = ORT_WASM_PATH;
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    return ort;
  });

  return runtimePromise;
}

export async function createOnnxSession(modelUrl: string): Promise<OnnxSession> {
  const ort = await loadRuntime();

  let session: import("onnxruntime-web/wasm").InferenceSession;
  try {
    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  } catch (error) {
    throw new QuickDrawOnnxError(
      `Unable to load the Quick Draw ONNX model from ${modelUrl}.`,
      { cause: error },
    );
  }

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const { outputSize } = QUICK_DRAW_RASTER;

  return {
    async run(input: Float32Array) {
      const tensor = new ort.Tensor("float32", input, [1, outputSize, outputSize, 1]);
      const output = await session.run({ [inputName]: tensor });
      return output[outputName].data as Float32Array;
    },
  };
}

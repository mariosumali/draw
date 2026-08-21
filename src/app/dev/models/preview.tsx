"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { DrawCanvas, type CanvasStroke } from "@/components/game/DrawCanvas";
import { VoiceControl } from "@/components/ui/VoiceControl";
import { buildNarrationScript } from "@/lib/audio/narration";
import { VoiceNarrator, type SpokenLine } from "@/lib/audio/voice";
import { DEFAULT_VOICE_SETTINGS, VoiceSettingsStore } from "@/lib/audio/voice-settings";
import { isMatchingPrediction } from "@/lib/game/guesses";
import { QUICK_DRAW_PROMPTS } from "@/lib/game/prompts";
import type { DrawingSnapshot, Prediction } from "@/lib/game/types";
import { classifyCanvasWithMobileViT, loadMobileViTModel } from "@/lib/quickdraw/mobilevit";
import {
  classifyCanvas,
  classifyStrokes,
  loadQuickDrawModel,
  QUICK_DRAW_MODELS,
  type QuickDrawModelId,
} from "@/lib/quickdraw/model";

type ModelLoadState = "loading" | "ready" | "error";
type ModelComparisonStatus = "idle" | "running" | "ready" | "error";
type DevModelId = QuickDrawModelId | "mobilevit-small" | "sketchxai-base";
type QuickDrawDevModelDescriptor = {
  id: QuickDrawModelId;
  name: string;
  summary: string;
  classesUrl: string;
  backend: "quickdraw";
};
type MobileViTDevModelDescriptor = {
  id: "mobilevit-small";
  name: string;
  summary: string;
  classesUrl: string;
  backend: "mobilevit";
};
type ServerDevModelDescriptor = {
  id: "sketchxai-base";
  name: string;
  summary: string;
  classesUrl: string;
  backend: "server";
};
type DevModelDescriptor = QuickDrawDevModelDescriptor | MobileViTDevModelDescriptor | ServerDevModelDescriptor;
type ModelComparisonResult = {
  modelId: DevModelId;
  predictions: Prediction[];
  status: ModelComparisonStatus;
  elapsedMs: number | null;
  error: string | null;
};

const MODEL_LAB_DEFAULT_MODEL_ID: DevModelId = "quickdraw-onnx";
const EMPTY_SPOKEN_LINES: SpokenLine[] = [];
const SKETCHXAI_CLASSES_URL = "/models/quickdraw-onnx/classes.json";
const DEV_MODELS: DevModelDescriptor[] = [
  ...QUICK_DRAW_MODELS.filter((model) => model.backend !== "ml5").map((model) => ({
    id: model.id,
    name: model.name,
    summary: model.summary,
    classesUrl: model.classesUrl,
    backend: "quickdraw" as const,
  })),
  {
    id: "mobilevit-small",
    name: "MobileViT ONNX",
    summary: "Browser-side Transformers.js model from Xenova/quickdraw-mobilevit-small.",
    classesUrl: SKETCHXAI_CLASSES_URL,
    backend: "mobilevit",
  },
  {
    id: "sketchxai-base",
    name: "SketchXAI Base",
    summary: "Server-side stroke model from WinKawaks/SketchXAI-Base-QuickDraw345.",
    classesUrl: SKETCHXAI_CLASSES_URL,
    backend: "server",
  },
];

export function ModelLabPreview() {
  const [selectedModelId, setSelectedModelId] = useState<DevModelId>(MODEL_LAB_DEFAULT_MODEL_ID);
  const voiceSettings = useSyncExternalStore(
    VoiceSettingsStore.subscribe,
    VoiceSettingsStore.get,
    () => DEFAULT_VOICE_SETTINGS,
  );
  const spokenLines = useSyncExternalStore(
    VoiceNarrator.subscribeHistory,
    VoiceNarrator.getHistory,
    () => EMPTY_SPOKEN_LINES,
  );
  const [classLabels, setClassLabels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<string>();
  const [promptSerial, setPromptSerial] = useState(0);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [comparisonResults, setComparisonResults] = useState<ModelComparisonResult[]>(createEmptyComparisonResults);
  const [loadState, setLoadState] = useState<ModelLoadState>("loading");
  const [status, setStatus] = useState("Loading model assets...");
  const [modelError, setModelError] = useState<string | null>(null);
  const [inferenceCount, setInferenceCount] = useState(0);
  const [lastRunMs, setLastRunMs] = useState<number | null>(null);
  const [recognizedCount, setRecognizedCount] = useState(0);
  const [lastRecognized, setLastRecognized] = useState<DrawingSnapshot | null>(null);
  const [savedSketch, setSavedSketch] = useState<DrawingSnapshot | null>(null);

  const selectedModel = useMemo(() => getDevModelDescriptor(selectedModelId), [selectedModelId]);
  const promptPool = useMemo(() => {
    return classLabels.length > 0 ? classLabels : [...QUICK_DRAW_PROMPTS];
  }, [classLabels]);
  const promptId = prompt ? `${selectedModelId}:${promptSerial}:${prompt}` : undefined;
  const matchedPrediction = prompt
    ? predictions.find((prediction) => isMatchingPrediction(prompt, prediction))
    : undefined;

  useEffect(() => {
    let cancelled = false;

    async function prepareModel() {
      setLoadState("loading");
      setStatus(`Loading ${selectedModel.name}...`);
      setModelError(null);

      const labels = await loadLabels(selectedModel.classesUrl).catch(() => [...QUICK_DRAW_PROMPTS]);
      if (cancelled) {
        return;
      }

      setClassLabels(labels);
      setPrompt((currentPrompt) => currentPrompt ?? pickPrompt(labels));

      try {
        if (selectedModel.backend === "quickdraw") {
          await loadQuickDrawModel(selectedModel.id);
        } else if (selectedModel.backend === "mobilevit") {
          await loadMobileViTModel();
        } else {
          await warmSketchXaiModel();
        }
        if (cancelled) {
          return;
        }
        setLoadState("ready");
        setStatus(`${selectedModel.name} ready with ${labels.length} prompts.`);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoadState("error");
        setModelError(modelErrorMessage(error));
        setStatus(`${selectedModel.name} could not be loaded.`);
      }
    }

    void prepareModel();

    return () => {
      cancelled = true;
    };
  }, [selectedModel]);

  const classify = useCallback(
    async (canvas: HTMLCanvasElement, strokes: CanvasStroke[], options: { finalPass: boolean }) => {
      const startedAt = performance.now();
      setStatus(`Running ${DEV_MODELS.length} models on this sketch...`);
      setModelError(null);
      setComparisonResults((currentResults) =>
        DEV_MODELS.map((model) => {
          const currentResult = currentResults.find((result) => result.modelId === model.id);
          return {
            modelId: model.id,
            predictions: currentResult?.predictions ?? [],
            status: "running",
            elapsedMs: null,
            error: null,
          };
        }),
      );

      const nextResults = await Promise.all(
        DEV_MODELS.map(async (model): Promise<ModelComparisonResult> => {
          const modelStartedAt = performance.now();

          try {
            const nextPredictions = await classifyDevModel(model, canvas, strokes, options);
            return {
              modelId: model.id,
              predictions: nextPredictions,
              status: "ready",
              elapsedMs: Math.round(performance.now() - modelStartedAt),
              error: null,
            };
          } catch (error) {
            return {
              modelId: model.id,
              predictions: [],
              status: "error",
              elapsedMs: Math.round(performance.now() - modelStartedAt),
              error: modelErrorMessage(error),
            };
          }
        }),
      );

      const elapsedMs = Math.round(performance.now() - startedAt);
      const selectedResult = nextResults.find((result) => result.modelId === selectedModel.id);
      const failedResults = nextResults.filter((result) => result.status === "error");

      setComparisonResults(nextResults);
      setInferenceCount((count) => count + 1);
      setLastRunMs(elapsedMs);

      if (selectedResult?.status === "error") {
        setLoadState("error");
        setModelError(selectedResult.error);
      } else {
        setLoadState("ready");
        setModelError(failedResults[0]?.error ?? null);
      }

      setStatus(
        failedResults.length > 0
          ? `Compared ${DEV_MODELS.length - failedResults.length}/${DEV_MODELS.length} models in ${elapsedMs} ms.`
          : `Compared all ${DEV_MODELS.length} models in ${elapsedMs} ms.`,
      );

      return selectedResult?.predictions ?? [];
    },
    [selectedModel.id],
  );

  const updatePredictions = useCallback((nextPredictions: Prediction[]) => {
    setPredictions((currentPredictions) => {
      return arePredictionsEqual(currentPredictions, nextPredictions) ? currentPredictions : nextPredictions;
    });
  }, []);

  const nextPrompt = useCallback(() => {
    setPrompt((currentPrompt) => pickPrompt(promptPool, currentPrompt));
    setPromptSerial((serial) => serial + 1);
    setPredictions([]);
    setComparisonResults(createEmptyComparisonResults());
    setLastRecognized(null);
    setSavedSketch(null);
  }, [promptPool]);

  const handleRecognized = useCallback((drawing: DrawingSnapshot) => {
    setRecognizedCount((count) => count + 1);
    setLastRecognized(drawing);
    setSavedSketch(drawing);
    setStatus(`Recognized "${drawing.prompt}" from ${drawing.predictions[0]?.label ?? "the drawing"}.`);
  }, []);

  const clearSavedSketch = useCallback(() => {
    setSavedSketch(null);
  }, []);

  /** Reads one model's guesses out loud without making it the active recognizer. */
  const speakModelGuesses = useCallback(
    (model: DevModelDescriptor, modelPredictions: Prediction[]) => {
      VoiceNarrator.prime();
      if (!VoiceSettingsStore.get().enabled) {
        VoiceSettingsStore.set({ enabled: true });
      }

      VoiceNarrator.speakScript(
        buildNarrationScript({
          predictions: modelPredictions,
          prompt,
          chattiness: VoiceSettingsStore.get().chattiness,
          seed: `${model.id}:${promptSerial}:${modelPredictions[0]?.label ?? ""}`,
        }),
        { source: model.name },
      );
    },
    [prompt, promptSerial],
  );

  return (
    <main className="page-shell room-shell dev-model-shell">
      <section className="dev-preview-bar panel">
        <div>
          <p className="eyebrow">Dev lab</p>
          <h1>Model tester</h1>
          <p className="muted">Draw once and compare every classifier against the exact same sketch.</p>
        </div>
        <div className="dev-preview-actions">
          <VoiceControl />
          <button className="button secondary" onClick={nextPrompt} type="button">
            New prompt
          </button>
          <button className="button" onClick={() => setSelectedModelId(MODEL_LAB_DEFAULT_MODEL_ID)} type="button">
            Use deployed model
          </button>
        </div>
      </section>

      <section className="dev-model-layout">
        <div className="dev-model-canvas">
          <DrawCanvas
            classify={classify}
            disabled={!prompt}
            mode="sprint"
            onPredictions={updatePredictions}
            onRecognized={handleRecognized}
            onSketchChange={setSavedSketch}
            onSketchClear={clearSavedSketch}
            prompt={prompt}
            promptId={promptId}
          />

          <section className="dev-model-comparison panel">
            <div className="dev-model-comparison-heading">
              <div>
                <p className="eyebrow">Same canvas</p>
                <h2>All model guesses</h2>
              </div>
              <p className="muted">
                The highlighted model is the active one used for the canvas&apos;s game-style “recognized” behavior.
              </p>
            </div>
            <div className="dev-model-result-grid">
              {DEV_MODELS.map((model) => {
                const result = comparisonResults.find((comparisonResult) => comparisonResult.modelId === model.id);
                const isActive = model.id === selectedModelId;

                return (
                  <article className={`dev-model-result-card ${isActive ? "active" : ""}`} key={model.id}>
                    <div className="dev-model-result-header">
                      <div>
                        <h3>{model.name}</h3>
                        <p>{isActive ? "Active recognizer" : "Comparison only"}</p>
                      </div>
                      <span className={`dev-model-result-status ${result?.status ?? "idle"}`}>
                        {formatModelStatus(result)}
                      </span>
                    </div>

                    {result?.error ? <p className="alert danger">{result.error}</p> : null}
                    {result && result.predictions.length > 0 ? (
                      <>
                        <ol className="prediction-list dev-model-predictions">
                          {result.predictions.map((prediction) => (
                            <li
                              className={prompt && isMatchingPrediction(prompt, prediction) ? "active" : undefined}
                              key={`${model.id}:${prediction.label}:${prediction.confidence}`}
                            >
                              <span>{prediction.label}</span>
                              <strong>{formatPercent(prediction.confidence)}</strong>
                            </li>
                          ))}
                        </ol>
                        <button
                          className="dev-model-speak-button"
                          onClick={() => speakModelGuesses(model, result.predictions)}
                          type="button"
                        >
                          Hear this model
                        </button>
                      </>
                    ) : (
                      <p className="muted">Draw a stroke to fill this in.</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="dev-model-sidebar">
          <section className="side-card panel">
            <h2>Models</h2>
            <div className="dev-model-options" role="radiogroup" aria-label="QuickDraw model">
              {DEV_MODELS.map((model) => (
                <button
                  aria-checked={model.id === selectedModelId}
                  className={`dev-model-option ${model.id === selectedModelId ? "active" : ""}`}
                  key={model.id}
                  onClick={() => setSelectedModelId(model.id)}
                  role="radio"
                  type="button"
                >
                  <strong>{model.name}</strong>
                  <span>{model.summary}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="side-card panel">
            <h2>Prompt</h2>
            <p className="dev-model-current-prompt">{prompt ?? "Loading..."}</p>
            <p className="muted">
              Active model: {selectedModel.name}. {classLabels.length || QUICK_DRAW_PROMPTS.length} available labels.
            </p>
            {matchedPrediction ? (
              <p className="dev-model-match">Matched at {formatPercent(matchedPrediction.confidence)} confidence.</p>
            ) : (
              <p className="muted">Each stroke runs the same canvas through all models below.</p>
            )}
          </section>

          <section className="side-card panel">
            <h2>Predictions</h2>
            {predictions.length > 0 ? (
              <ol className="prediction-list dev-model-predictions">
                {predictions.map((prediction) => (
                  <li
                    className={prompt && isMatchingPrediction(prompt, prediction) ? "active" : undefined}
                    key={`${prediction.label}:${prediction.confidence}`}
                  >
                    <span>{prediction.label}</span>
                    <strong>{formatPercent(prediction.confidence)}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">No guesses yet. Add a stroke to run inference.</p>
            )}
          </section>

          <section className="side-card panel">
            <h2>Narration</h2>
            {voiceSettings.enabled ? (
              <p className="muted">
                Speaking at {voiceSettings.rate.toFixed(2)}x, pitch {voiceSettings.pitch.toFixed(2)},{" "}
                {voiceSettings.chattiness}.
              </p>
            ) : (
              <p className="muted">The guessing voice is off. Turn it on in the voice settings above.</p>
            )}
            {spokenLines.length > 0 ? (
              <>
                <ol className="dev-model-transcript" aria-live="polite">
                  {spokenLines.map((line) => (
                    <li className={`dev-model-transcript-${line.kind}`} key={line.id}>
                      <span>{line.text}</span>
                      {line.source ? <small>{line.source}</small> : null}
                    </li>
                  ))}
                </ol>
                <button
                  className="dev-model-speak-button"
                  onClick={() => {
                    VoiceNarrator.cancel();
                    VoiceNarrator.clearHistory();
                  }}
                  type="button"
                >
                  Clear transcript
                </button>
              </>
            ) : (
              <p className="muted">Nothing said yet. Draw, or use “Hear this model”.</p>
            )}
          </section>

          <section className="side-card panel">
            <h2>Status</h2>
            <p className={`dev-model-status ${loadState}`}>{status}</p>
            {modelError ? <p className="alert danger">{modelError}</p> : null}
            <dl className="dev-model-stats">
              <div>
                <dt>Inferences</dt>
                <dd>{inferenceCount}</dd>
              </div>
              <div>
                <dt>Last run</dt>
                <dd>{lastRunMs === null ? "n/a" : `${lastRunMs} ms`}</dd>
              </div>
              <div>
                <dt>Recognized</dt>
                <dd>{recognizedCount}</dd>
              </div>
              <div>
                <dt>Sketch saved</dt>
                <dd>{savedSketch ? "yes" : "no"}</dd>
              </div>
            </dl>
            {lastRecognized ? (
              <p className="muted">Last match: {lastRecognized.prompt}</p>
            ) : null}
          </section>
        </aside>
      </section>
    </main>
  );
}

function createEmptyComparisonResults() {
  return DEV_MODELS.map((model): ModelComparisonResult => ({
    modelId: model.id,
    predictions: [],
    status: "idle",
    elapsedMs: null,
    error: null,
  }));
}

function getDevModelDescriptor(modelId: DevModelId) {
  return DEV_MODELS.find((model) => model.id === modelId) ?? DEV_MODELS[0];
}

async function warmSketchXaiModel() {
  const response = await fetch("/api/dev/sketchxai", {
    body: JSON.stringify({ height: 520, strokes: [], warm: true, width: 720 }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function classifySketchXai(
  strokes: CanvasStroke[],
  options: { enabled: boolean; height: number; width: number },
) {
  if (!options.enabled) {
    return [];
  }
  if (strokes.length === 0) {
    return [];
  }

  const response = await fetch("/api/dev/sketchxai", {
    body: JSON.stringify({ height: options.height, strokes, width: options.width }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as { predictions?: Prediction[] };
  return payload.predictions ?? [];
}

async function classifyDevModel(
  model: DevModelDescriptor,
  canvas: HTMLCanvasElement,
  strokes: CanvasStroke[],
  options: { finalPass: boolean },
) {
  if (model.backend === "quickdraw") {
    // ml5 DoodleNet takes an image; every other bundled model reads strokes.
    return model.id === "ml5-doodlenet"
      ? classifyCanvas(canvas, { modelId: model.id })
      : classifyStrokes(strokes, { modelId: model.id });
  }
  if (model.backend === "mobilevit") {
    return classifyCanvasWithMobileViT(canvas);
  }
  return classifySketchXai(strokes, {
    enabled: options.finalPass,
    height: canvas.height,
    width: canvas.width,
  });
}

function formatModelStatus(result: ModelComparisonResult | undefined) {
  if (!result || result.status === "idle") {
    return "idle";
  }

  if (result.status === "running") {
    return "running";
  }

  if (result.status === "error") {
    return result.elapsedMs === null ? "error" : `error ${result.elapsedMs}ms`;
  }

  return result.elapsedMs === null ? "ready" : `${result.elapsedMs}ms`;
}

async function loadLabels(classesUrl: string) {
  const response = await fetch(classesUrl);
  if (!response.ok) {
    throw new Error(`Unable to load labels from ${classesUrl}`);
  }

  const labels = (await response.json()) as unknown;
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")) {
    throw new Error("Model labels must be a string array.");
  }

  return labels;
}

function pickPrompt(labels: readonly string[], previousPrompt?: string) {
  if (labels.length === 0) {
    return undefined;
  }

  if (labels.length === 1) {
    return labels[0];
  }

  let nextPrompt = previousPrompt;
  while (!nextPrompt || nextPrompt === previousPrompt) {
    nextPrompt = labels[Math.floor(Math.random() * labels.length)];
  }
  return nextPrompt;
}

function formatPercent(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function arePredictionsEqual(left: Prediction[], right: Prediction[]) {
  return (
    left.length === right.length &&
    left.every((prediction, index) => {
      const otherPrediction = right[index];
      return (
        otherPrediction &&
        prediction.label === otherPrediction.label &&
        prediction.confidence === otherPrediction.confidence
      );
    })
  );
}

function modelErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "The selected model could not be loaded.";
}

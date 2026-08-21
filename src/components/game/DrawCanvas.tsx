"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { SketchyBorder } from "@/components/ui/SketchyBorder";
import { isMatchingPrediction } from "@/lib/game/guesses";
import { playDrawingMovementSound, stopDrawingSound } from "@/lib/audio/sfx";
import { type AnimatedGuessSnapshot, useAnimatedGuesses } from "@/hooks/useAnimatedGuesses";
import { useGuessNarration } from "@/hooks/useGuessNarration";
import { type DrawingSnapshot, type Prediction } from "@/lib/game/types";
import type { Stroke, StrokePoint } from "@/lib/quickdraw/raster";

type DrawCanvasProps = {
  disabled: boolean;
  prompt: string | undefined;
  promptId: string | undefined;
  classify: (
    canvas: HTMLCanvasElement,
    strokes: CanvasStroke[],
    options: { finalPass: boolean },
  ) => Promise<Prediction[]>;
  onPredictions: (predictions: Prediction[]) => void;
  onGuessStateChange?: (guessState: AnimatedGuessSnapshot) => void;
  onRecognized: (drawing: DrawingSnapshot) => void;
  onSkip?: (drawing: DrawingSnapshot | null) => void;
  onOutcomeChange?: (outcome: CanvasOutcome | null) => void;
  onSketchChange?: (drawing: DrawingSnapshot) => void;
  onSketchClear?: (drawingId: string) => void;
};

export type CanvasOutcome = {
  kind: "recognized" | "skipped";
  prompt: string;
  confidence?: number;
};

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 520;
const INK_LINE_WIDTH = 12.6;
const MIN_STROKE_DISTANCE = 0.75;
const RECOGNIZED_HOLD_MS = 1_250;
const SKIPPED_HOLD_MS = 650;

export function DrawCanvas({
  disabled,
  prompt,
  promptId,
  classify,
  onPredictions,
  onGuessStateChange,
  onRecognized,
  onSkip,
  onOutcomeChange,
  onSketchChange,
  onSketchClear,
}: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<CanvasPoint | null>(null);
  const strokesRef = useRef<CanvasStroke[]>([]);
  const activeStrokeRef = useRef<CanvasStroke | null>(null);
  const pendingInferenceRef = useRef(false);
  const queuedInferenceRef = useRef<"live" | "final" | null>(null);
  const inferenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognizedGuessRef = useRef<string | null>(null);
  const pendingRecognitionRef = useRef<PendingRecognition | null>(null);
  const outcomeRef = useRef<CanvasOutcome | null>(null);
  const sketchRevisionRef = useRef(0);
  const inferenceGenerationRef = useRef(0);
  const historyRef = useRef<ImageData[]>([]);
  const [hasInk, setHasInk] = useState(false);
  const [rawPredictions, setRawPredictions] = useState<Prediction[]>([]);
  const [outcome, setOutcome] = useState<CanvasOutcome | null>(null);
  const guessState = useAnimatedGuesses(rawPredictions, { resetKey: promptId ?? prompt });
  const primeVoice = useGuessNarration({
    guessState,
    predictions: rawPredictions,
    prompt,
    resetKey: promptId ?? prompt,
    active: !disabled,
    announcePrompt: true,
  });
  const onPredictionsRef = useRef(onPredictions);
  const onSketchClearRef = useRef(onSketchClear);
  const onOutcomeChangeRef = useRef(onOutcomeChange);
  const promptIdRef = useRef(promptId);

  useEffect(() => {
    onPredictionsRef.current = onPredictions;
    onSketchClearRef.current = onSketchClear;
    onOutcomeChangeRef.current = onOutcomeChange;
    promptIdRef.current = promptId;
  }, [onOutcomeChange, onPredictions, onSketchClear, promptId]);

  const clearCanvas = useCallback((options: { notifyClear?: boolean } = {}) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      return;
    }

    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawingRef.current = false;
    historyRef.current = [];
    lastPointRef.current = null;
    strokesRef.current = [];
    activeStrokeRef.current = null;
    recognizedGuessRef.current = null;
    pendingRecognitionRef.current = null;
    outcomeRef.current = null;
    sketchRevisionRef.current += 1;
    inferenceGenerationRef.current += 1;
    queuedInferenceRef.current = null;
    if (inferenceTimerRef.current) {
      clearTimeout(inferenceTimerRef.current);
      inferenceTimerRef.current = null;
    }
    stopDrawingSound();
    setHasInk(false);
    setRawPredictions([]);
    setOutcome(null);
    onOutcomeChangeRef.current?.(null);
    onPredictionsRef.current([]);

    const activePromptId = promptIdRef.current;
    if (options.notifyClear !== false && activePromptId) {
      onSketchClearRef.current?.(activePromptId);
    }
  }, []);

  useEffect(() => {
    if (!outcomeRef.current) {
      clearCanvas({ notifyClear: false });
    }
  }, [clearCanvas, prompt, promptId]);

  useEffect(() => {
    if (!outcome) {
      return;
    }

    const holdMs = outcome.kind === "recognized" ? RECOGNIZED_HOLD_MS : SKIPPED_HOLD_MS;
    const timer = window.setTimeout(() => {
      clearCanvas({ notifyClear: false });
    }, holdMs);

    return () => window.clearTimeout(timer);
  }, [clearCanvas, outcome]);

  useEffect(() => {
    onPredictions(guessState.visiblePredictions);
    onGuessStateChange?.(guessState);
  }, [guessState, onGuessStateChange, onPredictions]);

  useEffect(() => {
    return () => {
      stopDrawingSound();
      if (inferenceTimerRef.current) {
        clearTimeout(inferenceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      stopDrawingSound();
    }
  }, [disabled]);

  const saveSketch = useCallback((predictions: Prediction[] = [], recognized = false) => {
    const canvas = canvasRef.current;
    if (!canvas || !prompt) {
      return null;
    }

    const drawing: DrawingSnapshot = {
      id: promptId ?? prompt,
      prompt,
      imageDataUrl: canvas.toDataURL("image/png"),
      predictions,
      recognized,
      savedAt: Date.now(),
    };

    onSketchChange?.(drawing);
    return drawing;
  }, [onSketchChange, prompt, promptId]);

  const beginOutcome = useCallback((nextOutcome: CanvasOutcome, predictions: Prediction[], recognized: boolean) => {
    if (outcomeRef.current || !prompt) {
      return;
    }

    stopDrawingSound();
    if (inferenceTimerRef.current) {
      clearTimeout(inferenceTimerRef.current);
      inferenceTimerRef.current = null;
    }
    inferenceGenerationRef.current += 1;
    queuedInferenceRef.current = null;
    pendingRecognitionRef.current = null;
    outcomeRef.current = nextOutcome;
    setOutcome(nextOutcome);
    onOutcomeChangeRef.current?.(nextOutcome);

    const drawing = hasInk ? saveSketch(predictions, recognized) : null;
    if (recognized && drawing) {
      onRecognized(drawing);
    } else if (!recognized) {
      onSkip?.(drawing);
    }
  }, [hasInk, onRecognized, onSkip, prompt, saveSketch]);

  useEffect(() => {
    const matchedPrediction = prompt
      ? rawPredictions.find((prediction) => isMatchingPrediction(prompt, prediction))
      : undefined;
    if (!prompt || !matchedPrediction) {
      return;
    }

    const recognizedKey = `${promptId ?? prompt}:${sketchRevisionRef.current}:${matchedPrediction.label}`;
    if (recognizedGuessRef.current === recognizedKey) {
      return;
    }

    recognizedGuessRef.current = recognizedKey;
    const pendingRecognition: PendingRecognition = {
      prompt,
      prediction: matchedPrediction,
      predictions: rawPredictions,
    };

    // A guess is allowed to land while the player is drawing, but the canvas
    // never yanks the pen away. Finish the current stroke before celebrating.
    if (drawingRef.current) {
      pendingRecognitionRef.current = pendingRecognition;
      return;
    }

    beginOutcome(
      { kind: "recognized", prompt, confidence: matchedPrediction.confidence },
      rawPredictions,
      true,
    );
  }, [
    beginOutcome,
    prompt,
    promptId,
    rawPredictions,
  ]);

  async function runInference(finalPass = false) {
    const canvas = canvasRef.current;
    if (!canvas || disabled || !prompt) {
      return;
    }

    if (pendingInferenceRef.current) {
      if (finalPass || !queuedInferenceRef.current) {
        queuedInferenceRef.current = finalPass ? "final" : "live";
      }
      return;
    }

    const generation = inferenceGenerationRef.current;
    const revision = sketchRevisionRef.current;
    pendingInferenceRef.current = true;
    try {
      const predictions = await classify(canvas, cloneStrokes(strokesRef.current), { finalPass });
      if (
        generation === inferenceGenerationRef.current &&
        revision === sketchRevisionRef.current &&
        !outcomeRef.current
      ) {
        setRawPredictions(predictions);
      }
    } catch {
      if (finalPass && generation === inferenceGenerationRef.current) {
        setRawPredictions([]);
      }
    } finally {
      pendingInferenceRef.current = false;

      const queuedInference = queuedInferenceRef.current;
      queuedInferenceRef.current = null;
      if (queuedInference && !outcomeRef.current) {
        void runInference(queuedInference === "final");
      }
    }
  }

  function scheduleInference() {
    if (inferenceTimerRef.current) {
      clearTimeout(inferenceTimerRef.current);
    }

    inferenceTimerRef.current = setTimeout(() => {
      inferenceTimerRef.current = null;
      void runInference(false);
    }, 450);
  }

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || outcomeRef.current) {
      return;
    }

    // Safari/iOS only allow speech that descends from a user gesture.
    primeVoice();

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      return;
    }

    historyRef.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
    if (historyRef.current.length > 12) {
      historyRef.current.shift();
    }

    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);

    const point = getCanvasPoint(canvas, event);
    lastPointRef.current = point;
    activeStrokeRef.current = [point];
    strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
    sketchRevisionRef.current += 1;

    context.fillStyle = "#1a1a1a";
    context.beginPath();
    context.arc(point.x, point.y, INK_LINE_WIDTH / 2, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(point.x, point.y);
    setHasInk(true);
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      return;
    }

    const point = getCanvasPoint(canvas, event);
    const lastPoint = lastPointRef.current;
    if (lastPoint && getPointDistance(lastPoint, point) < MIN_STROKE_DISTANCE) {
      return;
    }

    lastPointRef.current = point;
    activeStrokeRef.current?.push(point);
    sketchRevisionRef.current += 1;
    context.lineTo(point.x, point.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = INK_LINE_WIDTH;
    context.strokeStyle = "#1a1a1a";
    context.stroke();
    playDrawingMovementSound();
    setHasInk(true);
    scheduleInference();
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
      return;
    }

    drawingRef.current = false;
    lastPointRef.current = null;
    activeStrokeRef.current = null;
    stopDrawingSound();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    saveSketch();

    const pendingRecognition = pendingRecognitionRef.current;
    if (pendingRecognition && pendingRecognition.prompt === prompt) {
      beginOutcome(
        {
          kind: "recognized",
          prompt: pendingRecognition.prompt,
          confidence: pendingRecognition.prediction.confidence,
        },
        pendingRecognition.predictions,
        true,
      );
      return;
    }

    if (inferenceTimerRef.current) {
      clearTimeout(inferenceTimerRef.current);
      inferenceTimerRef.current = null;
    }
    void runInference(true);
  }

  function undo() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    const previous = historyRef.current.pop();
    if (!canvas || !context || !previous) {
      return;
    }

    context.putImageData(previous, 0, 0);
    strokesRef.current = strokesRef.current.slice(0, -1);
    sketchRevisionRef.current += 1;
    activeStrokeRef.current = null;
    const hasPreviousInk = historyRef.current.length > 0;
    setHasInk(hasPreviousInk);
    if (hasPreviousInk) {
      saveSketch();
    } else {
      const activePromptId = promptIdRef.current;
      if (activePromptId) {
        onSketchClearRef.current?.(activePromptId);
      }
    }
    scheduleInference();
  }

  function skipPrompt() {
    if (disabled || outcomeRef.current || !prompt || !onSkip) {
      return;
    }

    beginOutcome({ kind: "skipped", prompt }, rawPredictions, false);
  }

  return (
    <section className="draw-panel panel">
      <div className="canvas-toolbar">
        <div>
          <span className="toolbar-label">
            <DoodleDecoration type="pencil" size={16} style={{ marginRight: 4, verticalAlign: "middle" }} />
            Draw this
          </span>
          <strong>{outcome?.prompt ?? prompt ?? "Waiting..."}</strong>
        </div>
        <div className="toolbar-actions">
          <button className="button secondary" disabled={disabled || !hasInk} onClick={undo} type="button">
            Undo
          </button>
          <button className="button secondary" disabled={disabled || !hasInk} onClick={() => clearCanvas()} type="button">
            Clear
          </button>
          {onSkip ? (
            <button className="button secondary canvas-skip-button" disabled={disabled} onClick={skipPrompt} type="button">
              Pass
            </button>
          ) : null}
        </div>
      </div>

      <SketchyBorder className="draw-canvas-border" color="#1a1a1a" roughness={2} strokeWidth={3}>
        <div className={`draw-canvas-stage ${outcome ? `has-${outcome.kind}-outcome` : ""}`}>
          <canvas
            aria-disabled={disabled || Boolean(outcome)}
            aria-label="Drawing canvas"
            className="draw-canvas"
            height={CANVAS_HEIGHT}
            onPointerCancel={endStroke}
            onPointerDown={beginStroke}
            onPointerLeave={endStroke}
            onPointerMove={continueStroke}
            onPointerUp={endStroke}
            ref={canvasRef}
            width={CANVAS_WIDTH}
          />
          {outcome ? <CanvasOutcomeCard outcome={outcome} /> : null}
        </div>
      </SketchyBorder>
    </section>
  );
}

type CanvasPoint = StrokePoint;

type PendingRecognition = {
  prompt: string;
  prediction: Prediction;
  predictions: Prediction[];
};

function CanvasOutcomeCard({ outcome }: { outcome: CanvasOutcome }) {
  const recognized = outcome.kind === "recognized";

  return (
    <div className={`canvas-outcome canvas-outcome-${outcome.kind}`} role="status" aria-live="assertive">
      <span className="canvas-outcome-icon">
        <DoodleDecoration
          color={recognized ? "#2e7d32" : "#555"}
          size={54}
          type={recognized ? "checkmark" : "arrow"}
        />
      </span>
      <small>{recognized ? "The AI got it" : "Passed"}</small>
      <strong>{outcome.prompt}</strong>
      <p>
        {recognized
          ? `${Math.round((outcome.confidence ?? 0) * 100)}% match · +1 point`
          : "No penalty · fresh prompt coming up"}
      </p>
    </div>
  );
}

/** A single pen-down-to-pen-up path, in canvas pixel coordinates. */
export type CanvasStroke = StrokePoint[];

export type { Stroke };

function getCanvasPoint(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>): CanvasPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function getPointDistance(start: CanvasPoint, end: CanvasPoint) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function cloneStrokes(strokes: CanvasStroke[]) {
  return strokes.map((stroke) => stroke.map((point) => ({ ...point })));
}

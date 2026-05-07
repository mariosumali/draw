"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { SketchyBorder } from "@/components/ui/SketchyBorder";
import { isMatchingPrediction } from "@/lib/game/guesses";
import { startDrawingSound, stopDrawingSound } from "@/lib/audio/sfx";
import { type AnimatedGuessSnapshot, useAnimatedGuesses } from "@/hooks/useAnimatedGuesses";
import { type DrawingSnapshot, type Prediction } from "@/lib/game/types";

type DrawCanvasProps = {
  disabled: boolean;
  prompt: string | undefined;
  promptId: string | undefined;
  classify: (canvas: HTMLCanvasElement) => Promise<Prediction[]>;
  onPredictions: (predictions: Prediction[]) => void;
  onGuessStateChange?: (guessState: AnimatedGuessSnapshot) => void;
  onRecognized: (drawing: DrawingSnapshot) => void;
  onSketchChange?: (drawing: DrawingSnapshot) => void;
  onSketchClear?: (drawingId: string) => void;
};

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 520;
const INK_LINE_WIDTH = 12.6;

export function DrawCanvas({
  disabled,
  prompt,
  promptId,
  classify,
  onPredictions,
  onGuessStateChange,
  onRecognized,
  onSketchChange,
  onSketchClear,
}: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const pendingInferenceRef = useRef(false);
  const queuedFinalInferenceRef = useRef(false);
  const inferenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognizedGuessRef = useRef<string | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const [hasInk, setHasInk] = useState(false);
  const [rawPredictions, setRawPredictions] = useState<Prediction[]>([]);
  const guessState = useAnimatedGuesses(rawPredictions, { resetKey: promptId ?? prompt });

  const clearCanvas = useCallback((options: { notifyClear?: boolean } = {}) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      return;
    }

    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    historyRef.current = [];
    recognizedGuessRef.current = null;
    setHasInk(false);
    setRawPredictions([]);
    onPredictions([]);
    if (options.notifyClear !== false && promptId) {
      onSketchClear?.(promptId);
    }
  }, [onPredictions, onSketchClear, promptId]);

  useEffect(() => {
    clearCanvas({ notifyClear: false });
  }, [clearCanvas, prompt]);

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

  useEffect(() => {
    const activePrediction = guessState.activePrediction;
    if (!prompt || !activePrediction || !isMatchingPrediction(prompt, activePrediction)) {
      return;
    }

    const recognizedKey = `${promptId ?? prompt}:${guessState.signature}:${activePrediction.label}`;
    if (recognizedGuessRef.current === recognizedKey) {
      return;
    }

    recognizedGuessRef.current = recognizedKey;
    const drawing = saveSketch(rawPredictions, true);
    if (drawing) {
      onRecognized(drawing);
    }
    clearCanvas({ notifyClear: false });
  }, [
    clearCanvas,
    guessState.activePrediction,
    guessState.signature,
    onRecognized,
    prompt,
    promptId,
    rawPredictions,
    saveSketch,
  ]);

  async function runInference(finalPass = false) {
    const canvas = canvasRef.current;
    if (!canvas || disabled || !prompt) {
      return;
    }

    if (pendingInferenceRef.current) {
      queuedFinalInferenceRef.current ||= finalPass;
      return;
    }

    pendingInferenceRef.current = true;
    try {
      const predictions = await classify(canvas);
      setRawPredictions(predictions);
    } catch {
      if (finalPass) {
        setRawPredictions([]);
      }
    } finally {
      pendingInferenceRef.current = false;

      if (queuedFinalInferenceRef.current) {
        queuedFinalInferenceRef.current = false;
        void runInference(true);
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
    if (disabled) {
      return;
    }

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
    startDrawingSound();
    canvas.setPointerCapture(event.pointerId);

    const point = getCanvasPoint(canvas, event);
    context.beginPath();
    context.moveTo(point.x, point.y);
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
    context.lineTo(point.x, point.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = INK_LINE_WIDTH;
    context.strokeStyle = "#1a1a1a";
    context.stroke();
    setHasInk(true);
    scheduleInference();
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
      return;
    }

    drawingRef.current = false;
    stopDrawingSound();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    saveSketch();
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
    const hasPreviousInk = historyRef.current.length > 0;
    setHasInk(hasPreviousInk);
    if (hasPreviousInk) {
      saveSketch();
    } else if (promptId) {
      onSketchClear?.(promptId);
    }
    scheduleInference();
  }

  return (
    <section className="draw-panel panel">
      <div className="canvas-toolbar">
        <div>
          <span className="toolbar-label">
            <DoodleDecoration type="pencil" size={16} style={{ marginRight: 4, verticalAlign: "middle" }} />
            Draw this
          </span>
          <strong>{prompt ?? "Waiting..."}</strong>
        </div>
        <div className="toolbar-actions">
          <button className="button secondary" disabled={disabled || !hasInk} onClick={undo} type="button">
            Undo
          </button>
          <button className="button secondary" disabled={disabled || !hasInk} onClick={() => clearCanvas()} type="button">
            Clear
          </button>
        </div>
      </div>

      <SketchyBorder color="#1a1a1a" roughness={2} strokeWidth={3}>
        <canvas
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
      </SketchyBorder>
    </section>
  );
}

function getCanvasPoint(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

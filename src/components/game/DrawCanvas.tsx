"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { SketchyBorder } from "@/components/ui/SketchyBorder";
import { isRecognizedPrompt, type Prediction } from "@/lib/game/types";

type DrawCanvasProps = {
  disabled: boolean;
  prompt: string | undefined;
  classify: (canvas: HTMLCanvasElement) => Promise<Prediction[]>;
  onPredictions: (predictions: Prediction[]) => void;
  onRecognized: (predictions: Prediction[]) => void;
};

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 520;

export function DrawCanvas({
  disabled,
  prompt,
  classify,
  onPredictions,
  onRecognized,
}: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const pendingInferenceRef = useRef(false);
  const inferenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const [hasInk, setHasInk] = useState(false);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      return;
    }

    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    historyRef.current = [];
    setHasInk(false);
    onPredictions([]);
  }, [onPredictions]);

  useEffect(() => {
    clearCanvas();
  }, [clearCanvas, prompt]);

  useEffect(() => {
    return () => {
      if (inferenceTimerRef.current) {
        clearTimeout(inferenceTimerRef.current);
      }
    };
  }, []);

  const runInference = useCallback(
    async (finalPass = false) => {
      const canvas = canvasRef.current;
      if (!canvas || disabled || !prompt || pendingInferenceRef.current) {
        return;
      }

      pendingInferenceRef.current = true;
      try {
        const predictions = await classify(canvas);
        onPredictions(predictions);

        if (isRecognizedPrompt(prompt, predictions)) {
          onRecognized(predictions);
          clearCanvas();
        }
      } catch {
        if (finalPass) {
          onPredictions([]);
        }
      } finally {
        pendingInferenceRef.current = false;
      }
    },
    [classify, clearCanvas, disabled, onPredictions, onRecognized, prompt],
  );

  const scheduleInference = useCallback(() => {
    if (inferenceTimerRef.current) {
      clearTimeout(inferenceTimerRef.current);
    }

    inferenceTimerRef.current = setTimeout(() => {
      void runInference(false);
    }, 450);
  }, [runInference]);

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
    context.lineWidth = 18;
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
    event.currentTarget.releasePointerCapture(event.pointerId);
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
    setHasInk(historyRef.current.length > 0);
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
          <button className="button secondary" disabled={disabled || !hasInk} onClick={clearCanvas} type="button">
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

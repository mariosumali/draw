"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAnimatedGuesses } from "@/hooks/useAnimatedGuesses";
import { useGuessNarration } from "@/hooks/useGuessNarration";
import { useRecognizerPreload } from "@/hooks/useRecognizerPreload";
import { playDrawingMovementSound, stopDrawingSound } from "@/lib/audio/sfx";
import { classifyStrokes, QuickDrawModelAssetError } from "@/lib/quickdraw/model";
import type { Stroke, StrokePoint } from "@/lib/quickdraw/raster";
import { Ml5DoodleNetError } from "@/lib/quickdraw/ml5-doodlenet";
import type { Prediction } from "@/lib/game/types";

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 320;
const INK_LINE_WIDTH = 11.2;
const MIN_STROKE_DISTANCE = 0.75;

export function LandingDemoCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<CanvasPoint | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<StrokePoint[] | null>(null);
  const hasInkRef = useRef(false);
  const pendingInferenceRef = useRef(false);
  const queuedInferenceRef = useRef(false);
  const inferenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rawPredictions, setRawPredictions] = useState<Prediction[]>([]);
  const [hasInk, setHasInk] = useState(false);
  const [isGuessing, setIsGuessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { loadState: recognizerLoadState, error: recognizerLoadError } = useRecognizerPreload();
  const guessState = useAnimatedGuesses(rawPredictions);
  const primeVoice = useGuessNarration({ guessState, active: recognizerLoadState === "ready" });
  const recognizerReady = recognizerLoadState === "ready";
  const predictions = guessState.visiblePredictions;

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      return;
    }

    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawingRef.current = false;
    lastPointRef.current = null;
    strokesRef.current = [];
    activeStrokeRef.current = null;
    stopDrawingSound();
    setRawPredictions([]);
    setHasInk(false);
    hasInkRef.current = false;
    setError(null);
  }, []);

  useEffect(() => {
    clearCanvas();
    return () => {
      stopDrawingSound();
      if (inferenceTimerRef.current) {
        clearTimeout(inferenceTimerRef.current);
      }
    };
  }, [clearCanvas]);

  async function runInference() {
    if (!hasInkRef.current || !recognizerReady) {
      return;
    }

    if (pendingInferenceRef.current) {
      queuedInferenceRef.current = true;
      return;
    }

    pendingInferenceRef.current = true;
    setIsGuessing(true);
    try {
      setError(null);
      setRawPredictions(await classifyStrokes(strokesRef.current));
    } catch (classificationError) {
      setRawPredictions([]);
      setError(
        classificationError instanceof Ml5DoodleNetError
          ? classificationError.message
          : classificationError instanceof QuickDrawModelAssetError
            ? "The Quick Draw model could not be loaded."
            : "The model could not classify this drawing.",
      );
    } finally {
      pendingInferenceRef.current = false;
      setIsGuessing(false);

      if (queuedInferenceRef.current) {
        queuedInferenceRef.current = false;
        void runInference();
      }
    }
  }

  function scheduleInference() {
    if (inferenceTimerRef.current) {
      clearTimeout(inferenceTimerRef.current);
    }

    inferenceTimerRef.current = setTimeout(() => {
      inferenceTimerRef.current = null;
      void runInference();
    }, 450);
  }

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!recognizerReady) {
      return;
    }

    // Safari/iOS only allow speech that descends from a user gesture.
    primeVoice();

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      return;
    }

    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);

    const point = getCanvasPoint(canvas, event);
    lastPointRef.current = point;
    activeStrokeRef.current = [point];
    strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) {
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
    context.lineTo(point.x, point.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = INK_LINE_WIDTH;
    context.strokeStyle = "#1a1a1a";
    context.stroke();
    playDrawingMovementSound();
    setHasInk(true);
    hasInkRef.current = true;
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
    if (inferenceTimerRef.current) {
      clearTimeout(inferenceTimerRef.current);
      inferenceTimerRef.current = null;
    }
    void runInference();
  }

  return (
    <div className="landing-demo">
      <div className="landing-demo-main">
        <div className="landing-demo-header">
          <div>
            <p className="warm-up-label">Warm-up</p>
            <h2>Try the recognizer.</h2>
            <p>Doodle anything in the box. The model reads your strokes and shouts out guesses.</p>
          </div>
        </div>

        <div className="landing-demo-canvas-wrap">
          <canvas
            aria-label="Try drawing for AI guesses"
            className="landing-demo-canvas"
            height={CANVAS_HEIGHT}
            onPointerCancel={endStroke}
            onPointerDown={beginStroke}
            onPointerLeave={endStroke}
            onPointerMove={continueStroke}
            onPointerUp={endStroke}
            ref={canvasRef}
            width={CANVAS_WIDTH}
          />
          {!hasInk ? (
            <div className="landing-demo-placeholder" aria-hidden="true">
              <PlaceholderPencil />
              <span>draw something here &rarr;</span>
            </div>
          ) : null}
          <button className="button secondary canvas-clear-button" disabled={!hasInk} onClick={clearCanvas} type="button">
            Clear
          </button>
        </div>

        <div className="landing-demo-guesses" aria-live="polite">
          <strong>Guesses &rarr;</strong>
          {recognizerLoadState === "loading" ? (
            <p className="muted">Loading DoodleNet (ml5.js)...</p>
          ) : recognizerLoadError ? (
            <p className="muted">{recognizerLoadError}</p>
          ) : error ? (
            <p className="muted">{error}</p>
          ) : guessState.status === "thinking" || isGuessing ? (
            <p className="guess-status thinking">thinking</p>
          ) : predictions.length ? (
            predictions.slice(0, 3).map((prediction) => (
              <span
                className={guessState.activePrediction?.label === prediction.label ? "active" : ""}
                key={prediction.label}
              >
                {prediction.label} <strong>{Math.round(prediction.confidence * 100)}%</strong>
              </span>
            ))
          ) : (
            <p className="muted">{isGuessing ? "Guessing..." : "thinking"}</p>
          )}
        </div>
      </div>

      <aside className="landing-demo-notes" aria-label="How a round works">
        <div className="rules-card">
          <p>How a round goes</p>
          <ol>
            <li>Get a secret prompt</li>
            <li>Sketch it before time runs out</li>
            <li>AI guesses &rarr; points for you</li>
            <li>Highest score wins the match</li>
          </ol>
        </div>
        <figure className="quote-card">
          <blockquote>&quot;Is that... a pelican on a skateboard?&quot;</blockquote>
          <figcaption>The recognizer, probably</figcaption>
        </figure>
      </aside>
    </div>
  );
}

function PlaceholderPencil() {
  return (
    <svg
      aria-hidden="true"
      className="placeholder-pencil"
      fill="none"
      height="30"
      viewBox="0 0 190 30"
      width="190"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M13 9.5c40-2.5 84-2.5 126 0v11c-42 2.5-86 2.5-126 0z" fill="#fff176" />
      <path d="M139 9.5 174 21l-35-.5z" fill="#fffdf7" />
      <path d="m158 15.5 16 5.5-16-.5z" fill="#1a1a1a" />
      <path d="M13 9.5c40-2.5 84-2.5 126 0v11c-42 2.5-86 2.5-126 0z" stroke="#1a1a1a" strokeWidth="4" />
      <path d="M139 9.5 174 21l-35-.5" stroke="#1a1a1a" strokeLinejoin="round" strokeWidth="4" />
      <path d="M13 9.5v11" stroke="#1a1a1a" strokeWidth="5" />
    </svg>
  );
}

type CanvasPoint = StrokePoint;

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

"use client";

import { useCallback, useState } from "react";

import type { CanvasStroke } from "@/components/game/DrawCanvas";
import { EMPTY_ANIMATED_GUESS_SNAPSHOT, type AnimatedGuessSnapshot } from "@/hooks/useAnimatedGuesses";
import { useRecognizerPreload } from "@/hooks/useRecognizerPreload";
import type { Prediction } from "@/lib/game/types";
import { Ml5DoodleNetError } from "@/lib/quickdraw/ml5-doodlenet";
import { classifyStrokes, QuickDrawModelAssetError } from "@/lib/quickdraw/model";

export function useArcadeRecognizer() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [guessState, setGuessState] = useState<AnimatedGuessSnapshot>(EMPTY_ANIMATED_GUESS_SNAPSHOT);
  const [modelError, setModelError] = useState<string | null>(null);
  const { loadState, error: preloadError } = useRecognizerPreload();

  const classify = useCallback(async (_canvas: HTMLCanvasElement, strokes: CanvasStroke[]) => {
    try {
      setModelError(null);
      return await classifyStrokes(strokes);
    } catch (error) {
      const message =
        error instanceof Ml5DoodleNetError
          ? error.message
          : error instanceof QuickDrawModelAssetError
            ? "The drawing model is missing its local assets."
            : "The AI lost the thread. Clear the canvas and try once more.";
      setModelError(message);
      return [];
    }
  }, []);

  const resetFeedback = useCallback(() => {
    setPredictions([]);
    setGuessState(EMPTY_ANIMATED_GUESS_SNAPSHOT);
    setModelError(null);
  }, []);

  return {
    classify,
    error: modelError ?? preloadError,
    guessState,
    loadState,
    predictions,
    resetFeedback,
    setGuessState,
    setPredictions,
  };
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { getPredictionSignature } from "@/lib/game/guesses";
import { RECOGNITION_TOP_N, type Prediction } from "@/lib/game/types";

export type AnimatedGuessStatus = "idle" | "thinking" | "revealing" | "complete";

export type AnimatedGuessSnapshot = {
  status: AnimatedGuessStatus;
  visiblePredictions: Prediction[];
  activePrediction: Prediction | null;
  topPredictions: Prediction[];
  signature: string;
  exhausted: boolean;
};

export const EMPTY_ANIMATED_GUESS_SNAPSHOT: AnimatedGuessSnapshot = {
  status: "idle",
  visiblePredictions: [],
  activePrediction: null,
  topPredictions: [],
  signature: "",
  exhausted: false,
};

type AnimatedGuessOptions = {
  resetKey?: string;
  topN?: number;
  thinkingDelayMs?: number;
  revealDelayMs?: number;
};

export function useAnimatedGuesses(
  predictions: Prediction[],
  {
    resetKey,
    topN = RECOGNITION_TOP_N,
    thinkingDelayMs = 450,
    revealDelayMs = 650,
  }: AnimatedGuessOptions = {},
) {
  const topPredictions = useMemo(() => predictions.slice(0, topN), [predictions, topN]);
  const signature = useMemo(() => getPredictionSignature(topPredictions, topN), [topPredictions, topN]);
  const topPredictionsRef = useRef<Prediction[]>(topPredictions);
  const [snapshot, setSnapshot] = useState<AnimatedGuessSnapshot>(EMPTY_ANIMATED_GUESS_SNAPSHOT);

  useEffect(() => {
    topPredictionsRef.current = topPredictions;
  }, [topPredictions]);

  useEffect(() => {
    const guesses = topPredictionsRef.current;
    if (!signature || guesses.length === 0) {
      setSnapshot(EMPTY_ANIMATED_GUESS_SNAPSHOT);
      return;
    }

    const timers: number[] = [];
    setSnapshot({
      status: "thinking",
      visiblePredictions: [],
      activePrediction: null,
      topPredictions: guesses,
      signature,
      exhausted: false,
    });

    guesses.forEach((prediction, index) => {
      const delay = thinkingDelayMs + revealDelayMs * index;
      timers.push(
        window.setTimeout(() => {
          const isLastGuess = index === guesses.length - 1;
          setSnapshot({
            status: isLastGuess ? "complete" : "revealing",
            visiblePredictions: guesses.slice(0, index + 1),
            activePrediction: prediction,
            topPredictions: guesses,
            signature,
            exhausted: isLastGuess,
          });
        }, delay),
      );
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [resetKey, revealDelayMs, signature, thinkingDelayMs]);

  return snapshot;
}

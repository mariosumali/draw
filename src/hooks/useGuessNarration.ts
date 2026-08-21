"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { buildNarrationLine } from "@/lib/audio/narration";
import { VoiceNarrator } from "@/lib/audio/voice";
import {
  CHATTINESS_GUESS_LIMIT,
  DEFAULT_VOICE_SETTINGS,
  VoiceSettingsStore,
} from "@/lib/audio/voice-settings";
import { getPredictionSignature, isMatchingPrediction } from "@/lib/game/guesses";
import type { Prediction } from "@/lib/game/types";
import type { AnimatedGuessSnapshot } from "@/hooks/useAnimatedGuesses";

/** Don't re-announce the same label until the sketch has really moved on. */
const GUESS_REPEAT_COOLDOWN_MS = 9_000;
const THINKING_COOLDOWN_MS = 7_000;
const STUMPED_COOLDOWN_MS = 14_000;
const RECOGNIZED_COOLDOWN_MS = 4_000;

export type UseGuessNarrationOptions = {
  /** Live snapshot from `useAnimatedGuesses`. */
  guessState: AnimatedGuessSnapshot;
  /** Target word, when there is one. Drives the "Oh, I know!" payoff. */
  prompt?: string;
  /** Fresh model output, used to land the payoff without waiting on the visual reveal queue. */
  predictions?: Prediction[];
  /** Changing this starts a fresh sketch: repeat suppression resets. */
  resetKey?: string;
  /** Gate narration off while the round is paused, finished, or disabled. */
  active?: boolean;
  /** Read the prompt out loud when it changes (chatty setting only). */
  announcePrompt?: boolean;
};

/**
 * Speaks the recognizer's running guesses in the style of Quick, Draw!'s
 * narrator: filler while it thinks, a guess per reveal, and an excited
 * interruption the moment it lands on the prompt.
 */
export function useGuessNarration({
  guessState,
  prompt,
  predictions = [],
  resetKey,
  active = true,
  announcePrompt = false,
}: UseGuessNarrationOptions) {
  const settings = useSyncExternalStore(
    VoiceSettingsStore.subscribe,
    VoiceSettingsStore.get,
    () => DEFAULT_VOICE_SETTINGS,
  );

  const guessStateRef = useRef(guessState);
  const promptRef = useRef(prompt);
  const recognizedRef = useRef(false);

  const { chattiness, enabled } = settings;
  const narrating = enabled && active;
  const guessLimit = CHATTINESS_GUESS_LIMIT[chattiness];

  const { status, signature, exhausted } = guessState;
  const revealedCount = guessState.visiblePredictions.length;
  const activeLabel = guessState.activePrediction?.label;
  const immediateMatch = prompt
    ? predictions.find((prediction) => isMatchingPrediction(prompt, prediction))
    : undefined;
  const immediateMatchLabel = immediateMatch?.label;
  const immediateMatchSignature = immediateMatch ? getPredictionSignature(predictions) : "";

  useEffect(() => {
    guessStateRef.current = guessState;
    promptRef.current = prompt;
  }, [guessState, prompt]);

  // A new prompt is a clean slate for the narrator.
  useEffect(() => {
    recognizedRef.current = false;
    // Chatter about the previous sketch is stale, but let a payoff line land.
    VoiceNarrator.cancelChatter();
    VoiceNarrator.resetDedupe();
  }, [prompt, resetKey]);

  useEffect(() => {
    if (!narrating || !announcePrompt || chattiness !== "chatty" || !prompt) {
      return;
    }

    VoiceNarrator.speak(buildNarrationLine({ kind: "prompt", prompt, seed: resetKey ?? prompt }));
  }, [announcePrompt, chattiness, narrating, prompt, resetKey]);

  useEffect(() => {
    if (!narrating) {
      VoiceNarrator.cancel();
    }
  }, [narrating]);

  useEffect(() => {
    if (!narrating || !immediateMatch || recognizedRef.current) {
      return;
    }

    recognizedRef.current = true;
    VoiceNarrator.speak(
      buildNarrationLine({
        kind: "recognized",
        label: immediateMatch.label,
        seed: immediateMatchSignature || immediateMatch.label,
      }),
      { dedupeMs: RECOGNIZED_COOLDOWN_MS },
    );
  }, [immediateMatch, immediateMatchLabel, immediateMatchSignature, narrating]);

  useEffect(() => {
    // Canvas cleared: forget what was already said so the next sketch is fresh.
    if (!signature) {
      if (!immediateMatch) {
        recognizedRef.current = false;
        VoiceNarrator.resetDedupe();
      }
      return;
    }

    if (!narrating || recognizedRef.current) {
      return;
    }

    if (status === "thinking") {
      if (chattiness === "quiet") {
        return;
      }

      VoiceNarrator.speak(buildNarrationLine({ kind: "thinking", seed: signature }), {
        dedupeMs: THINKING_COOLDOWN_MS,
      });
      return;
    }

    const snapshot = guessStateRef.current;
    const prediction = snapshot.activePrediction;
    const targetPrompt = promptRef.current;
    if (!prediction) {
      return;
    }

    const index = Math.max(0, snapshot.visiblePredictions.length - 1);

    if (targetPrompt && isMatchingPrediction(targetPrompt, prediction)) {
      if (recognizedRef.current) {
        return;
      }

      recognizedRef.current = true;
      VoiceNarrator.speak(
        buildNarrationLine({ kind: "recognized", label: prediction.label, seed: signature }),
        { dedupeMs: RECOGNIZED_COOLDOWN_MS },
      );
      return;
    }

    // Repeat suppression lives in the narrator, which only records a label
    // once it is really spoken — a line the queue drops stays eligible.
    if (index < guessLimit) {
      VoiceNarrator.speak(
        buildNarrationLine({
          kind: "guess",
          label: prediction.label,
          index,
          confidence: prediction.confidence,
          seed: signature,
        }),
        { dedupeMs: GUESS_REPEAT_COOLDOWN_MS },
      );
    }

    // Giving up only makes sense when there was a word it failed to guess.
    if (targetPrompt && exhausted && chattiness !== "quiet" && !recognizedRef.current) {
      VoiceNarrator.speak(buildNarrationLine({ kind: "stumped", seed: signature }), {
        dedupeMs: STUMPED_COOLDOWN_MS,
      });
    }
  }, [activeLabel, chattiness, exhausted, guessLimit, immediateMatch, narrating, revealedCount, signature, status]);

  useEffect(() => {
    // Whatever the player taps or types first wakes the engine, so Safari and
    // iOS can hear the first guess even if it never touched the canvas.
    VoiceNarrator.unlockOnGesture();
    return () => {
      VoiceNarrator.cancel();
    };
  }, []);

  return useCallback(() => {
    VoiceNarrator.prime();
  }, []);
}

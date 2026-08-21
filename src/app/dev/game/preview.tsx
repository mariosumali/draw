"use client";

import { useCallback, useEffect, useState } from "react";

import { BattleStage } from "@/components/game/RoomClient";
import { EMPTY_ANIMATED_GUESS_SNAPSHOT, type AnimatedGuessSnapshot } from "@/hooks/useAnimatedGuesses";
import type { DrawingSnapshot, GameState, PlayerState, Prediction } from "@/lib/game/types";

const PROMPTS = ["pelican on a skateboard", "sleepy robot", "pizza moon", "tiny dragon", "beach bicycle"];
const ROUND_DURATION_MS = 90_000;
const PREVIEW_START_TIME = 1_700_000_000_000;

export function GamePagePreview() {
  const [receivedAt, setReceivedAt] = useState(PREVIEW_START_TIME);
  const [state, setState] = useState(() => createPreviewState(PREVIEW_START_TIME));
  const [predictions, setPredictions] = useState<Prediction[]>(previewPredictions(PROMPTS[1], 0));
  const [guessState, setGuessState] = useState<AnimatedGuessSnapshot>(EMPTY_ANIMATED_GUESS_SNAPSHOT);
  const [drawings, setDrawings] = useState<DrawingSnapshot[]>([]);
  const [inferenceCount, setInferenceCount] = useState(0);

  const localPlayer = state.players[0];
  const currentPrompt = localPlayer ? state.prompts[localPlayer.promptIndex] : undefined;
  const opponents = state.players.filter((player) => player.id !== localPlayer?.id && player.connected);
  const currentPromptId = localPlayer && currentPrompt ? `${localPlayer.promptIndex}:${currentPrompt}` : undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setReceivedAt(now);
      setState(createPreviewState(now));
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const classify = useCallback(async () => {
    const nextInferenceCount = inferenceCount + 1;
    setInferenceCount(nextInferenceCount);
    return previewPredictions(currentPrompt ?? PROMPTS[0], nextInferenceCount);
  }, [currentPrompt, inferenceCount]);

  const saveDrawing = useCallback((drawing: DrawingSnapshot) => {
    setDrawings((currentDrawings) => {
      const existingIndex = currentDrawings.findIndex((currentDrawing) => currentDrawing.id === drawing.id);
      if (existingIndex === -1) {
        return [...currentDrawings, drawing];
      }

      const nextDrawings = [...currentDrawings];
      nextDrawings[existingIndex] = drawing;
      return nextDrawings;
    });
  }, []);

  const clearDrawing = useCallback((drawingId: string) => {
    setDrawings((currentDrawings) => currentDrawings.filter((drawing) => drawing.id !== drawingId));
  }, []);

  const completePrompt = useCallback((drawing: DrawingSnapshot) => {
    saveDrawing(drawing);
    setInferenceCount(0);
    setPredictions([]);
    setState((currentState) => ({
      ...currentState,
      players: currentState.players.map((player) => {
        if (player.id !== "preview-player") {
          return player;
        }

        const nextPromptIndex = Math.min(player.promptIndex + 1, currentState.prompts.length);
        return {
          ...player,
          completedPrompts: [...new Set([...player.completedPrompts, drawing.prompt])],
          promptIndex: nextPromptIndex,
          score: player.score + 1,
        };
      }),
    }));
  }, [saveDrawing]);

  function resetPreview() {
    const now = Date.now();
    setReceivedAt(now);
    setState(createPreviewState(now));
    setPredictions(previewPredictions(PROMPTS[1], 0));
    setGuessState(EMPTY_ANIMATED_GUESS_SNAPSHOT);
    setDrawings([]);
    setInferenceCount(0);
  }

  function restartTimer() {
    const now = Date.now();
    setReceivedAt(now);
    setState((currentState) => ({
      ...currentState,
      phase: "playing",
      serverNow: now,
      startedAt: now,
      endsAt: now + ROUND_DURATION_MS,
      countdownStartedAt: undefined,
    }));
  }

  function showCountdown() {
    const now = Date.now();
    setReceivedAt(now);
    setState((currentState) => ({
      ...currentState,
      phase: "countdown",
      serverNow: now,
      countdownStartedAt: now,
      startedAt: undefined,
      endsAt: undefined,
    }));
  }

  return (
    <main className="page-shell room-shell dev-game-shell">
      <section className="dev-preview-bar panel">
        <div>
          <p className="eyebrow">Dev preview</p>
          <h1>Active game page</h1>
          <p className="muted">Mock room state for checking layout and testing the canvas without PartyKit.</p>
        </div>
        <div className="dev-preview-actions">
          <button className="button secondary" onClick={showCountdown} type="button">
            Countdown
          </button>
          <button className="button secondary" onClick={restartTimer} type="button">
            Restart timer
          </button>
          <button className="button" onClick={resetPreview} type="button">
            Reset preview
          </button>
        </div>
      </section>

      <BattleStage
        canDraw={state.phase === "playing" && Boolean(currentPrompt)}
        classify={classify}
        currentPrompt={currentPrompt}
        currentPromptId={currentPromptId}
        guessState={guessState}
        lastError={null}
        localPlayer={localPlayer}
        modelError={null}
        recognizerLoadState="ready"
        onGuessStateChange={setGuessState}
        onLeaveRoom={() => window.alert("Preview only: this would leave the room.")}
        onPredictions={setPredictions}
        onRecognized={completePrompt}
        onSkip={(drawing) => {
          if (drawing) saveDrawing(drawing);
          setInferenceCount(0);
          setPredictions([]);
          setState((currentState) => ({
            ...currentState,
            players: currentState.players.map((player) =>
              player.id === "preview-player"
                ? { ...player, promptIndex: Math.min(player.promptIndex + 1, currentState.prompts.length) }
                : player,
            ),
          }));
        }}
        onSketchChange={saveDrawing}
        onSketchClear={clearDrawing}
        opponents={opponents}
        predictions={predictions}
        receivedAt={receivedAt}
        roomId={state.roomId}
        state={state}
      />

      <p className="dev-preview-note muted">
        Saved sketches in this preview: {drawings.length}. Draw a few strokes and wait for fake AI guesses to update.
      </p>
    </main>
  );
}

function createPreviewState(now: number): GameState {
  const players: PlayerState[] = [
    player("preview-player", "Player", 0, 1, 1, now),
    player("preview-mira", "Mira", 1, 2, 2, now),
    player("preview-jules", "Jules", 2, 2, 2, now),
    player("preview-aki", "Aki", 3, 0, 0, now),
  ];

  return {
    roomId: "ROOM-XGYM",
    phase: "playing",
    players,
    spectators: 1,
    chatMessages: [
      {
        id: "preview-chat-1",
        playerId: "preview-mira",
        playerName: "Mira",
        text: "duck on a plank lol",
        sentAt: now - 18_000,
      },
      {
        id: "preview-chat-2",
        playerId: "preview-jules",
        playerName: "Jules",
        text: "I see... a flamingo??",
        sentAt: now - 8_000,
      },
    ],
    prompts: PROMPTS,
    maxPlayers: players.length,
    roundDurationMs: ROUND_DURATION_MS,
    serverNow: now,
    startedAt: now,
    endsAt: now + 74_000,
    winnerId: null,
  };
}

function player(id: string, name: string, slot: number, score: number, promptIndex: number, now: number): PlayerState {
  return {
    id,
    name,
    slot,
    score,
    ready: true,
    connected: true,
    promptIndex,
    completedPrompts: PROMPTS.slice(0, promptIndex),
    lastSeen: now,
  };
}

function previewPredictions(prompt: string, count: number): Prediction[] {
  if (count >= 3) {
    return [
      { label: prompt, confidence: 0.91 },
      { label: "pelican", confidence: 0.74 },
      { label: "skateboard", confidence: 0.63 },
    ];
  }

  if (count >= 1) {
    return [
      { label: "pelican", confidence: 0.68 },
      { label: "bird", confidence: 0.58 },
      { label: "flamingo", confidence: 0.45 },
    ];
  }

  return [
    { label: "bird", confidence: 0.42 },
    { label: "duck", confidence: 0.28 },
    { label: "penguin", confidence: 0.2 },
  ];
}

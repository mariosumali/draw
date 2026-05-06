"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import usePartySocket from "partysocket/react";

import { DrawCanvas } from "@/components/game/DrawCanvas";
import { GameHud } from "@/components/game/GameHud";
import { PromptList } from "@/components/game/PromptList";
import { ResultPanel } from "@/components/game/ResultPanel";
import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { useGameSounds } from "@/hooks/useGameSounds";
import { classifyCanvas, QuickDrawModelAssetError } from "@/lib/quickdraw/model";
import type { ClientMessage, GameState, Prediction, ServerMessage } from "@/lib/game/types";

type RoomClientProps = {
  roomId: string;
  initialName?: string;
};

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999";

type ReceivedGameState = {
  state: GameState;
  receivedAt: number;
};

export function RoomClient({ roomId, initialName }: RoomClientProps) {
  const [playerId] = useState(() => getOrCreatePlayerId(roomId));
  const [playerName, setPlayerName] = useState(initialName?.slice(0, 24) || "Player");
  const [receivedGameState, setReceivedGameState] = useState<ReceivedGameState | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const socket = usePartySocket({
    host: PARTYKIT_HOST,
    room: roomId,
    onMessage(event) {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "state") {
        setReceivedGameState({ state: message.state, receivedAt: Date.now() });
        setLastError(null);
      } else {
        setLastError(message.message);
      }
    },
  });

  const sendMessage = useCallback(
    (message: ClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    [socket],
  );

  useEffect(() => {
    if (!playerId || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    sendMessage({ type: "join", playerId, name: playerName });
  }, [playerId, playerName, sendMessage, socket.readyState]);

  const gameState = receivedGameState?.state ?? null;
  const receivedAt = receivedGameState?.receivedAt ?? 0;
  const localPlayer = useMemo(() => {
    return gameState?.players.find((player) => player.id === playerId);
  }, [gameState?.players, playerId]);

  const currentPrompt = localPlayer ? gameState?.prompts[localPlayer.promptIndex] : undefined;
  const opponent = gameState?.players.find((player) => player.id !== playerId);
  const inviteUrl = typeof window === "undefined" ? "" : window.location.href.split("?")[0];
  const canDraw = gameState?.phase === "playing" && Boolean(currentPrompt) && !modelError;

  const { playClick } = useGameSounds({ gameState, localPlayer, receivedAt });

  const classify = useCallback(async (canvas: HTMLCanvasElement) => {
    try {
      setModelError(null);
      return await classifyCanvas(canvas);
    } catch (error) {
      const message =
        error instanceof QuickDrawModelAssetError
          ? "Quick Draw model assets are missing. Add a TF.js model bundle under public/models/quickdraw."
          : "Recognition failed. Try clearing the canvas and drawing again.";
      setModelError(message);
      return [];
    }
  }, []);

  const completePrompt = useCallback(
    (recognizedPredictions: Prediction[]) => {
      if (!playerId || !currentPrompt) {
        return;
      }

      sendMessage({
        type: "completePrompt",
        playerId,
        prompt: currentPrompt,
        confidence: recognizedPredictions[0]?.confidence ?? 0,
        predictions: recognizedPredictions,
      });
    },
    [currentPrompt, playerId, sendMessage],
  );

  function toggleReady() {
    if (!playerId || !localPlayer) {
      return;
    }

    playClick();
    sendMessage({ type: "ready", playerId, ready: !localPlayer.ready });
  }

  function resetRound() {
    if (!playerId) {
      return;
    }

    playClick();
    setPredictions([]);
    sendMessage({ type: "reset", playerId });
  }

  async function copyInvite() {
    playClick();
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="page-shell room-shell">
      <header className="room-header panel">
        <div>
          <p className="eyebrow">
            <DoodleDecoration type="circle" size={18} color="#e53935" style={{ marginRight: 4, verticalAlign: "middle" }} />
            Room {roomId}
          </p>
          <h1>Draw Battle!</h1>
        </div>
        <div className="invite-tools">
          <input
            aria-label="Display name"
            maxLength={24}
            onChange={(event) => setPlayerName(event.target.value)}
            value={playerName}
            placeholder="Your name"
          />
          <button className="button secondary" onClick={copyInvite} type="button">
            {copied ? "Copied!" : "Copy invite"}
          </button>
          <SoundToggle />
        </div>
      </header>

      {gameState ? (
        <>
          <GameHud localPlayer={localPlayer} receivedAt={receivedAt} state={gameState} />
          <section className="game-grid">
            <div className="play-column">
              <div className="ready-panel panel">
                <div>
                  <strong>{statusText(gameState, localPlayer?.ready ?? false, Boolean(opponent))}</strong>
                  <p className="muted">
                    {opponent
                      ? <>vs. <DoodleDecoration type="pencil" size={16} style={{ marginRight: 2, verticalAlign: "middle" }} />{opponent.name}</>
                      : "Waiting for a sketching buddy to join..."}
                  </p>
                </div>
                <button
                  className="button"
                  disabled={!localPlayer || gameState.phase !== "waiting"}
                  onClick={toggleReady}
                  type="button"
                >
                  {localPlayer?.ready ? "Unready" : "Ready!"}
                </button>
              </div>

              {modelError ? <div className="alert warning">{modelError}</div> : null}
              {lastError ? <div className="alert danger">{lastError}</div> : null}

              <DrawCanvas
                classify={classify}
                disabled={!canDraw}
                onPredictions={setPredictions}
                onRecognized={completePrompt}
                prompt={currentPrompt}
              />
            </div>

            <aside className="side-column">
              <PredictionPanel predictions={predictions} />
              <PromptList player={localPlayer} prompts={gameState.prompts} />
            </aside>
          </section>

          <ResultPanel localPlayer={localPlayer} onReset={resetRound} state={gameState} />
        </>
      ) : (
        <section className="panel loading-card">
          <DoodleDecoration type="pencil" size={28} style={{ marginRight: 8, verticalAlign: "middle" }} />
          Sharpening pencils...
        </section>
      )}
    </main>
  );
}

function PredictionPanel({ predictions }: { predictions: Prediction[] }) {
  return (
    <section className="side-card panel">
      <h2>
        <DoodleDecoration type="circle" size={20} color="#90caf9" style={{ marginRight: 6, verticalAlign: "middle" }} />
        AI guesses
      </h2>
      {predictions.length ? (
        <ol className="prediction-list">
          {predictions.map((prediction) => (
            <li key={prediction.label}>
              <span>{prediction.label}</span>
              <strong>{Math.round(prediction.confidence * 100)}%</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Start doodling to see what the AI thinks!</p>
      )}
    </section>
  );
}

function statusText(state: GameState, ready: boolean, hasOpponent: boolean) {
  if (state.phase === "waiting") {
    if (!hasOpponent) {
      return "Share your invite link!";
    }
    return ready ? "Pencils ready! Waiting for opponent..." : "Click ready when you want to sketch!";
  }

  if (state.phase === "countdown") {
    return "Get your pencils ready!";
  }

  if (state.phase === "playing") {
    return "Sketch it! Quick!";
  }

  return "Pencils down!";
}

function getOrCreatePlayerId(roomId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const storageKey = `draw-battle:${roomId}:player-id`;
  const existingId = window.sessionStorage.getItem(storageKey);
  const nextId = existingId ?? window.crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, nextId);
  return nextId;
}

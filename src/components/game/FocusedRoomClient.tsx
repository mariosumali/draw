"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import { DrawCanvas } from "@/components/game/DrawCanvas";
import { LobbyRoster } from "@/components/game/LobbyRoster";
import { ResultPanel } from "@/components/game/ResultPanel";
import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { EMPTY_ANIMATED_GUESS_SNAPSHOT, type AnimatedGuessSnapshot } from "@/hooks/useAnimatedGuesses";
import { isMatchingPrediction } from "@/lib/game/guesses";
import { classifyCanvas, QuickDrawModelAssetError } from "@/lib/quickdraw/model";
import type { ClientMessage, DrawingSnapshot, GameState, Prediction, ServerMessage } from "@/lib/game/types";

type FocusedRoomClientProps = {
  roomId: string;
  initialName?: string;
};

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999";

type ReceivedGameState = {
  state: GameState;
  receivedAt: number;
};

export function FocusedRoomClient({ roomId, initialName }: FocusedRoomClientProps) {
  const router = useRouter();
  const [playerId] = useState(() => getOrCreatePlayerId(roomId));
  const [playerName, setPlayerName] = useState(initialName?.slice(0, 24) || "Player");
  const [receivedGameState, setReceivedGameState] = useState<ReceivedGameState | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [guessState, setGuessState] = useState<AnimatedGuessSnapshot>(EMPTY_ANIMATED_GUESS_SNAPSHOT);
  const [drawings, setDrawings] = useState<DrawingSnapshot[]>([]);
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
        if (message.state.phase === "waiting") {
          setDrawings([]);
          setPredictions([]);
          setGuessState(EMPTY_ANIMATED_GUESS_SNAPSHOT);
        }
      } else if (message.type === "lobbyDeleted") {
        clearPlayerId(roomId);
        router.replace("/");
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
    if (!playerId || socket.readyState !== WebSocket.OPEN) return;
    sendMessage({ type: "join", playerId, name: playerName });
  }, [playerId, playerName, sendMessage, socket.readyState]);

  const gameState = receivedGameState?.state ?? null;
  const receivedAt = receivedGameState?.receivedAt ?? 0;
  const localPlayer = useMemo(() => {
    return gameState?.players.find((p) => p.id === playerId);
  }, [gameState?.players, playerId]);

  const currentPrompt = localPlayer ? gameState?.prompts[localPlayer.promptIndex] : undefined;
  const connectedPlayers = gameState?.players.filter((p) => p.connected) ?? [];
  const readyPlayers = connectedPlayers.filter((p) => p.ready);
  const opponent = connectedPlayers.find((p) => p.id !== playerId);
  const inviteUrl = typeof window === "undefined" ? "" : window.location.href.split("?")[0];
  const canDraw = gameState?.phase === "playing" && Boolean(currentPrompt) && !modelError;
  const currentPromptId = localPlayer && currentPrompt ? `${localPlayer.promptIndex}:${currentPrompt}` : undefined;

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

  const removeDrawing = useCallback((drawingId: string) => {
    setDrawings((currentDrawings) => currentDrawings.filter((drawing) => drawing.id !== drawingId));
  }, []);

  const classify = useCallback(async (canvas: HTMLCanvasElement) => {
    try {
      setModelError(null);
      return await classifyCanvas(canvas);
    } catch (error) {
      const message =
        error instanceof QuickDrawModelAssetError
          ? "Model assets missing."
          : "Recognition failed.";
      setModelError(message);
      return [];
    }
  }, []);

  const completePrompt = useCallback(
    (drawing: DrawingSnapshot) => {
      if (!playerId || !currentPrompt) return;
      saveDrawing(drawing);
      const matchedPrediction = drawing.predictions.find((prediction) => isMatchingPrediction(currentPrompt, prediction));
      sendMessage({
        type: "completePrompt",
        playerId,
        prompt: currentPrompt,
        confidence: matchedPrediction?.confidence ?? drawing.predictions[0]?.confidence ?? 0,
        predictions: drawing.predictions,
      });
    },
    [currentPrompt, playerId, saveDrawing, sendMessage],
  );

  function toggleReady() {
    if (!playerId || !localPlayer) return;
    sendMessage({ type: "ready", playerId, ready: !localPlayer.ready });
  }

  function resetRound() {
    if (!playerId) return;
    setPredictions([]);
    setGuessState(EMPTY_ANIMATED_GUESS_SNAPSHOT);
    setDrawings([]);
    sendMessage({ type: "reset", playerId });
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (!gameState) {
    return (
      <main className="focused-shell">
        <div className="focused-loading">
          <DoodleDecoration type="pencil" size={32} />
          <span>Connecting...</span>
        </div>
      </main>
    );
  }

  const isWaiting = gameState.phase === "waiting";
  const isCountdown = gameState.phase === "countdown";

  return (
    <main className="focused-shell">
      {/* Top bar: tiny room info + timer + score */}
      <header className="focused-topbar">
        <div className="focused-topbar-left">
          <span className="focused-room-id">
            <DoodleDecoration type="circle" size={12} color="#e53935" style={{ marginRight: 4, verticalAlign: "middle" }} />
            {roomId}
          </span>
          <input
            className="focused-name-input"
            aria-label="Display name"
            maxLength={24}
            onChange={(e) => setPlayerName(e.target.value)}
            value={playerName}
            placeholder="Name"
          />
          <button className="focused-copy-btn" onClick={copyInvite} type="button">
            {copied ? "Copied!" : "Invite"}
          </button>
        </div>
        <div className="focused-topbar-right">
          {opponent && <span className="focused-opponent">vs. {opponent.name}</span>}
          <span className="focused-score">
            {localPlayer?.score ?? 0}
            <DoodleDecoration type="star" size={14} color="#ff9800" style={{ marginLeft: 3, verticalAlign: "middle" }} />
          </span>
          <Timer state={gameState} receivedAt={receivedAt} />
        </div>
      </header>

      {/* Pre-game: waiting/ready */}
      {isWaiting && (
        <section className="focused-lobby" aria-label="Lobby status">
          <div className="focused-waiting">
            <div>
              <strong>
                {connectedPlayers.length < gameState.maxPlayers
                  ? "Waiting for players"
                  : localPlayer?.ready
                    ? "Ready. Waiting for others."
                    : "Ready to start?"}
              </strong>
              <p>
                {connectedPlayers.length < gameState.maxPlayers
                  ? `${gameState.maxPlayers - connectedPlayers.length} open seat${gameState.maxPlayers - connectedPlayers.length === 1 ? "" : "s"} left.`
                  : `${readyPlayers.length}/${connectedPlayers.length} player${connectedPlayers.length === 1 ? "" : "s"} ready.`}
              </p>
            </div>
            <button
              className="button"
              disabled={!localPlayer || connectedPlayers.length < gameState.maxPlayers}
              onClick={toggleReady}
              type="button"
            >
              {localPlayer?.ready ? "Unready" : "Ready"}
            </button>
          </div>
          <LobbyRoster compact players={gameState.players} maxPlayers={gameState.maxPlayers} localPlayerId={playerId} />
        </section>
      )}

      {/* Countdown overlay */}
      {isCountdown && (
        <div className="focused-countdown">
          <CountdownNumber state={gameState} receivedAt={receivedAt} />
        </div>
      )}

      {/* Errors */}
      {modelError && <div className="focused-error">{modelError}</div>}
      {lastError && <div className="focused-error">{lastError}</div>}

      {/* Canvas area -- the star of the show */}
      <div className="focused-canvas-area">
        <DrawCanvas
          classify={classify}
          disabled={!canDraw}
          onGuessStateChange={setGuessState}
          onPredictions={setPredictions}
          onSketchChange={saveDrawing}
          onSketchClear={removeDrawing}
          onRecognized={completePrompt}
          prompt={currentPrompt}
          promptId={currentPromptId}
        />
      </div>

      {/* Bottom bar: AI guesses as inline pills */}
      {(guessState.status === "thinking" || predictions.length > 0) && (
        <div className="focused-guesses">
          <span className="focused-guesses-label">
            {guessState.status === "thinking" ? "AI is thinking..." : "AI thinks:"}
          </span>
          {predictions.slice(0, 3).map((p) => (
            <span
              key={p.label}
              className={`focused-guess-pill ${guessState.activePrediction?.label === p.label ? "active" : ""}`}
            >
              {p.label} <strong>{Math.round(p.confidence * 100)}%</strong>
            </span>
          ))}
        </div>
      )}

      <ResultPanel drawings={drawings} localPlayer={localPlayer} onReset={resetRound} state={gameState} />
    </main>
  );
}

/* ─── Timer (inline) ─── */

function Timer({ state, receivedAt }: { state: GameState; receivedAt: number }) {
  const serverNow = useSyncedServerNow(state, receivedAt);
  const remainingMs =
    state.phase === "playing" && state.endsAt
      ? Math.max(0, state.endsAt - serverNow)
      : state.roundDurationMs;

  if (state.phase !== "playing") return null;

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const urgent = totalSeconds <= 15;

  return (
    <span className={`focused-timer ${urgent ? "focused-timer-urgent" : ""}`}>
      {timeStr}
    </span>
  );
}

function CountdownNumber({ state, receivedAt }: { state: GameState; receivedAt: number }) {
  const serverNow = useSyncedServerNow(state, receivedAt);
  const countdownMs =
    state.phase === "countdown" && state.countdownStartedAt
      ? Math.max(0, state.countdownStartedAt + 3_000 - serverNow)
      : 0;

  return <span className="focused-countdown-number">{Math.ceil(countdownMs / 1000)}</span>;
}

function useSyncedServerNow(state: GameState, receivedAt: number) {
  const [clientNow, setClientNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.phase !== "countdown" && state.phase !== "playing") return;
    const timer = window.setInterval(() => setClientNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.phase]);

  return state.serverNow + Math.max(0, clientNow - receivedAt);
}

function getOrCreatePlayerId(roomId: string) {
  if (typeof window === "undefined") return null;
  const storageKey = `draw-battle:${roomId}:player-id`;
  const existingId = window.sessionStorage.getItem(storageKey);
  const nextId = existingId ?? window.crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, nextId);
  return nextId;
}

function clearPlayerId(roomId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(`draw-battle:${roomId}:player-id`);
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import usePartySocket from "partysocket/react";

import { DrawCanvas } from "@/components/game/DrawCanvas";
import { ResultPanel } from "@/components/game/ResultPanel";
import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { classifyCanvas, QuickDrawModelAssetError } from "@/lib/quickdraw/model";
import type { ClientMessage, GameState, Prediction, ServerMessage } from "@/lib/game/types";

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
    if (!playerId || socket.readyState !== WebSocket.OPEN) return;
    sendMessage({ type: "join", playerId, name: playerName });
  }, [playerId, playerName, sendMessage, socket.readyState]);

  const gameState = receivedGameState?.state ?? null;
  const receivedAt = receivedGameState?.receivedAt ?? 0;
  const localPlayer = useMemo(() => {
    return gameState?.players.find((p) => p.id === playerId);
  }, [gameState?.players, playerId]);

  const currentPrompt = localPlayer ? gameState?.prompts[localPlayer.promptIndex] : undefined;
  const opponent = gameState?.players.find((p) => p.id !== playerId);
  const inviteUrl = typeof window === "undefined" ? "" : window.location.href.split("?")[0];
  const canDraw = gameState?.phase === "playing" && Boolean(currentPrompt) && !modelError;

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
    (recognizedPredictions: Prediction[]) => {
      if (!playerId || !currentPrompt) return;
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
    if (!playerId || !localPlayer) return;
    sendMessage({ type: "ready", playerId, ready: !localPlayer.ready });
  }

  function resetRound() {
    if (!playerId) return;
    setPredictions([]);
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
          <span>Sharpening pencils...</span>
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
        <div className="focused-waiting">
          <p>
            {!opponent
              ? "Share your invite link to start!"
              : localPlayer?.ready
                ? "Waiting for opponent..."
                : "Ready to sketch?"}
          </p>
          <button
            className="button"
            disabled={!localPlayer}
            onClick={toggleReady}
            type="button"
          >
            {localPlayer?.ready ? "Unready" : "Ready!"}
          </button>
        </div>
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
          onPredictions={setPredictions}
          onRecognized={completePrompt}
          prompt={currentPrompt}
        />
      </div>

      {/* Bottom bar: AI guesses as inline pills */}
      {predictions.length > 0 && (
        <div className="focused-guesses">
          <span className="focused-guesses-label">AI thinks:</span>
          {predictions.slice(0, 3).map((p) => (
            <span key={p.label} className="focused-guess-pill">
              {p.label} <strong>{Math.round(p.confidence * 100)}%</strong>
            </span>
          ))}
        </div>
      )}

      <ResultPanel localPlayer={localPlayer} onReset={resetRound} state={gameState} />
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

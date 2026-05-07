"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";

import { DrawCanvas } from "@/components/game/DrawCanvas";
import { GameHud } from "@/components/game/GameHud";
import { LobbyRoster } from "@/components/game/LobbyRoster";
import { ResultPanel } from "@/components/game/ResultPanel";
import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { useGameSounds } from "@/hooks/useGameSounds";
import { EMPTY_ANIMATED_GUESS_SNAPSHOT, type AnimatedGuessSnapshot } from "@/hooks/useAnimatedGuesses";
import { isMatchingPrediction } from "@/lib/game/guesses";
import { classifyCanvas, QuickDrawModelAssetError } from "@/lib/quickdraw/model";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ClientMessage,
  type DrawingSnapshot,
  type GameState,
  type PlayerState,
  type Prediction,
  type ServerMessage,
} from "@/lib/game/types";

type RoomClientProps = {
  roomId: string;
  initialName?: string;
};

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999";
const ROUND_DURATION_OPTIONS_MS = [45_000, 60_000, 90_000, 120_000];
const PLAYER_COUNT_OPTIONS = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, index) => MIN_PLAYERS + index,
);

type ReceivedGameState = {
  state: GameState;
  receivedAt: number;
};

type LobbyOption = {
  value: number;
  label: string;
  disabled?: boolean;
};

export function RoomClient({ roomId, initialName }: RoomClientProps) {
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
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [lobbyChatInput, setLobbyChatInput] = useState("");

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
  const opponents = gameState?.players.filter((player) => player.id !== playerId && player.connected) ?? [];
  const connectedPlayers = gameState?.players.filter((player) => player.connected) ?? [];
  const readyPlayers = connectedPlayers.filter((player) => player.ready);
  const inviteUrl = typeof window === "undefined" ? "" : window.location.href.split("?")[0];
  const canDraw = gameState?.phase === "playing" && Boolean(currentPrompt) && !modelError;
  const currentPromptId = localPlayer && currentPrompt ? `${localPlayer.promptIndex}:${currentPrompt}` : undefined;
  const shouldShowLeaveConfirm = gameState?.phase === "waiting" && showLeaveConfirm;
  const isWaiting = gameState?.phase === "waiting";
  const openSeatCount = gameState ? Math.max(0, gameState.maxPlayers - connectedPlayers.length) : 0;

  const { playClick } = useGameSounds({ gameState, localPlayer, receivedAt });

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
          ? "Quick Draw model assets are missing. Add a TF.js model bundle under public/models/quickdraw."
          : "Recognition failed. Try clearing the canvas and drawing again.";
      setModelError(message);
      return [];
    }
  }, []);

  const completePrompt = useCallback(
    (drawing: DrawingSnapshot) => {
      if (!playerId || !currentPrompt) {
        return;
      }

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
    setGuessState(EMPTY_ANIMATED_GUESS_SNAPSHOT);
    setDrawings([]);
    sendMessage({ type: "reset", playerId });
  }

  function updateSettings(settings: Pick<ClientMessage & { type: "updateSettings" }, "maxPlayers" | "roundDurationMs">) {
    if (!playerId || !localPlayer || gameState?.phase !== "waiting") {
      return;
    }

    playClick();
    sendMessage({ type: "updateSettings", playerId, ...settings });
  }

  function requestLobbyBack() {
    playClick();
    setShowLeaveConfirm(true);
  }

  function leaveRoom() {
    playClick();
    clearPlayerId(roomId);
    router.replace("/");
  }

  function cancelLobbyBack() {
    playClick();
    setShowLeaveConfirm(false);
  }

  function deleteLobbyAndLeave() {
    if (!playerId || !localPlayer || gameState?.phase !== "waiting") {
      return;
    }

    playClick();
    sendMessage({ type: "deleteLobby", playerId });
    clearPlayerId(roomId);
    router.replace("/");
  }

  async function copyInvite() {
    playClick();
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function sendLobbyChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = lobbyChatInput.trim();
    if (!text || !playerId || !localPlayer) {
      return;
    }

    playClick();
    sendMessage({ type: "sendChat", playerId, text });
    setLobbyChatInput("");
  }

  return (
    <main className={`page-shell room-shell ${isWaiting ? "lobby-room-shell" : ""}`}>
      {isWaiting ? (
        <header className="room-header lobby-room-header">
          <div className="lobby-header-copy">
            <button className="lobby-back-pill" disabled={!localPlayer} onClick={requestLobbyBack} type="button">
              ← back
            </button>
            <p className="eyebrow lobby-room-code">
              <DoodleDecoration type="circle" size={18} color="#e53935" style={{ marginRight: 4, verticalAlign: "middle" }} />
              Room {roomId}
            </p>
            <h1>Set up the room.</h1>
            <p className="muted">
              Tweak the rules, share the link, then everyone hits ready. We start when the room agrees.
            </p>
          </div>
          <label className="lobby-player-badge">
            <span aria-hidden="true">{getInitials(playerName)}</span>
            <small>You are</small>
            <input
              aria-label="Display name"
              maxLength={24}
              onChange={(event) => setPlayerName(event.target.value)}
              value={playerName}
              placeholder="Player"
            />
          </label>
        </header>
      ) : null}

      {gameState ? (
        <>
          {gameState.phase !== "waiting" ? <GameHud localPlayer={localPlayer} receivedAt={receivedAt} state={gameState} /> : null}
          {gameState.phase === "waiting" ? (
            <section className="lobby-page">
              <div className="lobby-grid">
                <div className="lobby-card panel">
                  <p className="eyebrow">
                    <DoodleDecoration type="squiggle" size={34} color="#e88e8e" style={{ marginRight: 4, verticalAlign: "middle" }} />
                    Match settings
                  </p>

                  <div className="lobby-settings">
                    <LobbySegmentedSetting
                      disabled={!localPlayer}
                      hint="how long each player has to draw"
                      label="Round time"
                      onChange={(roundDurationMs) => updateSettings({ roundDurationMs })}
                      options={ROUND_DURATION_OPTIONS_MS.map((duration) => ({
                        value: duration,
                        label: formatDurationLabel(duration),
                      }))}
                      value={gameState.roundDurationMs}
                    />
                    <LobbySegmentedSetting
                      disabled={!localPlayer}
                      hint="seats in the room"
                      label="Max players"
                      onChange={(maxPlayers) => updateSettings({ maxPlayers })}
                      options={PLAYER_COUNT_OPTIONS.map((count) => ({
                        value: count,
                        label: String(count),
                        disabled: count < connectedPlayers.length,
                      }))}
                      value={gameState.maxPlayers}
                    />
                    <LobbyReadOnlySetting hint="best of..." label="Rounds" value="5" />
                    <LobbyReadOnlySetting hint="prompt deck" label="Difficulty" value="Mixed" />
                  </div>

                  {shouldShowLeaveConfirm ? (
                    <div className="lobby-delete-confirm" role="alert">
                      <div>
                        <strong>Go back and delete this lobby?</strong>
                        <p className="muted">This removes the waiting room and sends everyone back to the start page.</p>
                      </div>
                      <div className="lobby-delete-confirm-actions">
                        <button className="button secondary" onClick={cancelLobbyBack} type="button">
                          Stay here
                        </button>
                        <button className="button danger" disabled={!localPlayer} onClick={deleteLobbyAndLeave} type="button">
                          Delete lobby
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="lobby-actions">
                    <div>
                      <span className="lobby-status-label">Status</span>
                      <strong>{readyPlayers.length}/{gameState.maxPlayers} ready</strong>
                      <p className="muted">
                        {openSeatCount > 0
                          ? `${openSeatCount} open seat${openSeatCount === 1 ? "" : "s"} left.`
                          : `${readyPlayers.length}/${connectedPlayers.length} player${connectedPlayers.length === 1 ? "" : "s"} ready. The countdown starts when everyone is ready.`}
                      </p>
                    </div>
                    <div className="lobby-action-buttons">
                      <button className="button secondary" disabled={!localPlayer} onClick={requestLobbyBack} type="button">
                        Back
                      </button>
                      <button className="button" disabled={!localPlayer} onClick={toggleReady} type="button">
                        {localPlayer?.ready ? "✓ I'm ready" : "Mark me ready"}
                      </button>
                      <button className="button danger lobby-start-button" disabled type="button">
                        Start match
                      </button>
                    </div>
                  </div>
                </div>

                <aside className="side-column lobby-side-column">
                  <LobbyRoster players={gameState.players} maxPlayers={gameState.maxPlayers} localPlayerId={playerId} />
                  <section className="side-card panel lobby-note">
                    <h2>
                      <DoodleDecoration type="squiggle" size={44} color="#e88e8e" style={{ marginRight: 6, verticalAlign: "middle" }} />
                      Invite friends
                    </h2>
                    <p className="muted">Send this link. Extra people can spectate once the room is full.</p>
                    <div className="lobby-copy-row">
                      <code>{inviteUrl.replace(/^https?:\/\//, "")}</code>
                      <button onClick={copyInvite} type="button">
                        {copied ? "ok!" : "copy"}
                      </button>
                    </div>
                    <div className="lobby-share-row" aria-label="Share shortcuts">
                      <button onClick={copyInvite} type="button">Twitter</button>
                      <button onClick={copyInvite} type="button">Discord</button>
                      <button onClick={copyInvite} type="button">QR</button>
                    </div>
                  </section>
                  <section className="side-card panel lobby-chat-card">
                    <p className="lobby-chat-title">Room chat</p>
                    <div className="lobby-chat-messages" aria-live="polite">
                      {gameState.chatMessages.length ? (
                        gameState.chatMessages.map((message, index) => (
                          <p key={message.id} style={{ transform: `rotate(${getChatTilt(index)}deg)` }}>
                            <strong>{message.playerName}:</strong> {message.text}
                          </p>
                        ))
                      ) : (
                        <p className="lobby-chat-empty">
                          No messages yet. Say hi before the timer starts.
                        </p>
                      )}
                    </div>
                    <form className="lobby-chat-form" onSubmit={sendLobbyChat}>
                      <input
                        aria-label="Room chat message"
                        onChange={(event) => setLobbyChatInput(event.target.value)}
                        placeholder="say something..."
                        value={lobbyChatInput}
                      />
                      <button disabled={!lobbyChatInput.trim() || !localPlayer} type="submit">send</button>
                    </form>
                  </section>
                </aside>
              </div>
            </section>
          ) : (
            <BattleStage
              canDraw={canDraw}
              classify={classify}
              currentPrompt={currentPrompt}
              currentPromptId={currentPromptId}
              guessState={guessState}
              lastError={lastError}
              localPlayer={localPlayer}
              modelError={modelError}
              onGuessStateChange={setGuessState}
              onLeaveRoom={leaveRoom}
              onPredictions={setPredictions}
              onRecognized={completePrompt}
              onSketchChange={saveDrawing}
              onSketchClear={removeDrawing}
              opponents={opponents}
              predictions={predictions}
              receivedAt={receivedAt}
              roomId={roomId}
              state={gameState}
            />
          )}

          <ResultPanel drawings={drawings} localPlayer={localPlayer} onReset={resetRound} state={gameState} />
        </>
      ) : (
        <section className="panel loading-card">
          <DoodleDecoration type="pencil" size={28} style={{ marginRight: 8, verticalAlign: "middle" }} />
          Connecting...
        </section>
      )}
    </main>
  );
}

export function BattleStage({
  canDraw,
  classify,
  currentPrompt,
  currentPromptId,
  guessState,
  lastError,
  localPlayer,
  modelError,
  onGuessStateChange,
  onLeaveRoom,
  onPredictions,
  onRecognized,
  onSketchChange,
  onSketchClear,
  opponents,
  predictions,
  receivedAt,
  roomId,
  state,
}: {
  canDraw: boolean;
  classify: (canvas: HTMLCanvasElement) => Promise<Prediction[]>;
  currentPrompt: string | undefined;
  currentPromptId: string | undefined;
  guessState: AnimatedGuessSnapshot;
  lastError: string | null;
  localPlayer: PlayerState | undefined;
  modelError: string | null;
  onGuessStateChange: (guessState: AnimatedGuessSnapshot) => void;
  onLeaveRoom: () => void;
  onPredictions: (predictions: Prediction[]) => void;
  onRecognized: (drawing: DrawingSnapshot) => void;
  onSketchChange: (drawing: DrawingSnapshot) => void;
  onSketchClear: (drawingId: string) => void;
  opponents: PlayerState[];
  predictions: Prediction[];
  receivedAt: number;
  roomId: string;
  state: GameState;
}) {
  const roundNumber = Math.min((localPlayer?.promptIndex ?? 0) + 1, state.prompts.length);
  const opponentNames = opponents.map((player) => player.name).join(", ");
  const watcherCount = state.players.filter((player) => player.connected).length + state.spectators;

  return (
    <section className="battle-stage" aria-label="Drawing round">
      <header className="battle-header">
        <button className="battle-leave-button" onClick={onLeaveRoom} type="button">
          ← leave room
        </button>

        <div className="battle-prompt-card">
          <span>
            Round {roundNumber} of {state.prompts.length} · you&apos;re drawing
          </span>
          <strong>
            <span>&quot;</span>
            <mark>{currentPrompt ?? "waiting for prompt"}</mark>
            <span>&quot;</span>
          </strong>
        </div>

        <div className="battle-room-card" aria-label={`Room ${roomId}`}>
          <span>Room</span>
          <strong>{roomId}</strong>
        </div>
      </header>

      <BattleTimer receivedAt={receivedAt} state={state} />

      {modelError || lastError ? (
        <div className="battle-alerts" role="status">
          {modelError ? <span>{modelError}</span> : null}
          {lastError ? <span>{lastError}</span> : null}
        </div>
      ) : null}

      <div className="battle-layout">
        <div className="battle-canvas-column">
          {state.phase === "countdown" ? (
            <div className="battle-countdown-note">
              <CountdownNumber receivedAt={receivedAt} state={state} />
            </div>
          ) : null}

          <DrawCanvas
            classify={classify}
            disabled={!canDraw}
            onGuessStateChange={onGuessStateChange}
            onPredictions={onPredictions}
            onSketchChange={onSketchChange}
            onSketchClear={onSketchClear}
            onRecognized={onRecognized}
            prompt={currentPrompt}
            promptId={currentPromptId}
          />

          <footer className="battle-reaction-row" aria-label="Reaction controls">
            <div className="battle-reactions">
              {[
                { label: "laugh", icon: "ha" },
                { label: "fire", icon: "hot" },
                { label: "watching", icon: "see" },
                { label: "art", icon: "art" },
                { label: "doomed", icon: "rip" },
              ].map((reaction) => (
                <button aria-label={reaction.label} disabled key={reaction.label} type="button">
                  {reaction.icon}
                </button>
              ))}
            </div>
            <span>react to yourself</span>
          </footer>
        </div>

        <aside className="battle-side-stack">
          <ScoreboardPanel localPlayer={localPlayer} state={state} />
          <GuessFeedPanel guessState={guessState} predictions={predictions} />
        </aside>
      </div>

      <footer className="battle-footer">
        <p>
          <DoodleDecoration type="pencil" size={18} color="#ffcc33" style={{ marginRight: 8, verticalAlign: "middle" }} />
          Tip: shapes first, details after — recognizer rewards big silhouettes
        </p>
        <span>
          {localPlayer?.completedPrompts.length ?? 0} strokes · {watcherCount} watching · {opponentNames ? `vs. ${opponentNames}` : "waiting for rivals"}
        </span>
      </footer>
    </section>
  );
}

function BattleTimer({ state, receivedAt }: { state: GameState; receivedAt: number }) {
  const serverNow = useSyncedServerNow(state, receivedAt);
  const remainingMs =
    state.phase === "playing" && state.endsAt
      ? Math.max(0, state.endsAt - serverNow)
      : state.roundDurationMs;
  const progress =
    state.phase === "playing" && state.roundDurationMs > 0
      ? Math.max(0, Math.min(1, remainingMs / state.roundDurationMs))
      : 1;

  return (
    <div className="battle-timer-row">
      <strong>{formatClockTime(remainingMs)}</strong>
      <div className="battle-timer-track" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <span>{remainingMs <= 15_000 ? "Hurry!" : remainingMs <= 30_000 ? "Keep going" : "Plenty of time"}</span>
    </div>
  );
}

function CountdownNumber({ state, receivedAt }: { state: GameState; receivedAt: number }) {
  const serverNow = useSyncedServerNow(state, receivedAt);
  const countdownMs =
    state.phase === "countdown" && state.countdownStartedAt
      ? Math.max(0, state.countdownStartedAt + 3_000 - serverNow)
      : 0;

  return <span>{Math.ceil(countdownMs / 1000)}</span>;
}

function ScoreboardPanel({ state, localPlayer }: { state: GameState; localPlayer: PlayerState | undefined }) {
  const sortedPlayers = [...state.players]
    .filter((player) => player.connected || player.score > 0)
    .sort((a, b) => b.score - a.score || a.slot - b.slot);

  return (
    <section className="battle-paper-card battle-scoreboard" aria-label="Scoreboard">
      <h2>Scoreboard</h2>
      <ol>
        {sortedPlayers.map((player, index) => (
          <li className={player.id === localPlayer?.id ? "local" : ""} key={player.id}>
            <span className="battle-rank">{index + 1}</span>
            <span className="battle-avatar">{getInitials(player.name)}</span>
            <span className="battle-player-name">
              {player.name}
              {player.id === localPlayer?.id ? <em> you</em> : null}
              {player.id === localPlayer?.id ? <small>drawing</small> : null}
            </span>
            <strong>{player.score}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LobbySegmentedSetting({
  disabled,
  hint,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  hint: string;
  label: string;
  onChange: (value: number) => void;
  options: LobbyOption[];
  value: number;
}) {
  function selectOption(option: LobbyOption) {
    if (option.disabled || option.value === value) {
      return;
    }

    onChange(option.value);
  }

  return (
    <div className="lobby-setting">
      <div className="lobby-setting-label">
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <div className="lobby-segmented-control">
        {options.map((option) => (
          <button
            aria-pressed={option.value === value}
            className={option.value === value ? "selected" : ""}
            disabled={disabled || option.disabled}
            key={option.value}
            onClick={() => selectOption(option)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LobbyReadOnlySetting({ hint, label, value }: { hint: string; label: string; value: string }) {
  return (
    <div className="lobby-setting">
      <div className="lobby-setting-label">
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <div className="lobby-segmented-control lobby-readonly-control" aria-label={`${label}: ${value}`}>
        <button aria-pressed="true" className="selected" disabled type="button">
          {value}
        </button>
      </div>
    </div>
  );
}

function GuessFeedPanel({
  guessState,
  predictions,
}: {
  guessState: AnimatedGuessSnapshot;
  predictions: Prediction[];
}) {
  const isThinking = guessState.status === "thinking";

  return (
    <section className="battle-paper-card battle-guess-feed">
      <h2>Guess feed</h2>
      {isThinking ? (
        <p className="guess-status thinking">AI is thinking...</p>
      ) : predictions.length ? (
        <ol>
          {predictions.slice(0, 5).map((prediction, index) => {
            const isActive = guessState.activePrediction?.label === prediction.label;
            return (
              <li className={isActive ? "active" : ""} key={prediction.label}>
                <span>{index === 0 ? "AI:" : "Then:"}</span>
                <p>{guessCopy(index, prediction.label)}</p>
                <strong>{isActive ? "+100 ok" : `${Math.round(prediction.confidence * 100)}%`}</strong>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="battle-empty-feed">
          <p>AI: draw something bold.</p>
          <p>Tip: outlines beat details.</p>
        </div>
      )}
      {guessState.exhausted && predictions.length ? <p className="guess-status">No match yet. Keep drawing.</p> : null}
    </section>
  );
}

function guessCopy(index: number, label: string) {
  if (index === 0) {
    return `is it ${label}?`;
  }

  if (index === 1) {
    return `maybe ${label}.`;
  }

  return `could be ${label}.`;
}

function formatDurationLabel(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function formatClockTime(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getChatTilt(index: number) {
  return ((index % 5) - 2) * 0.8;
}

function useSyncedServerNow(state: GameState, receivedAt: number) {
  const [clientNow, setClientNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.phase !== "countdown" && state.phase !== "playing") {
      return;
    }

    const timer = window.setInterval(() => setClientNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.phase]);

  return state.serverNow + Math.max(0, clientNow - receivedAt);
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "PL";
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

function clearPlayerId(roomId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(`draw-battle:${roomId}:player-id`);
}

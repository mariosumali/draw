import type { GameMode } from "@/lib/game/modes";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_MAX_PLAYERS = 2;
export const COUNTDOWN_MS = 3_000;
export const MIN_ROUND_DURATION_MS = 45_000;
export const ROUND_DURATION_MS = 90_000;
export const MAX_ROUND_DURATION_MS = 180_000;
export const RECOGNITION_CONFIDENCE = 0.45;
export const RECOGNITION_TOP_N = 5;

export type GamePhase = "waiting" | "countdown" | "playing" | "finished";

export type Prediction = {
  label: string;
  confidence: number;
};

export type DrawingSnapshot = {
  id: string;
  prompt: string;
  imageDataUrl: string;
  predictions: Prediction[];
  recognized: boolean;
  savedAt: number;
  /** Pen-down gestures used for mode scoring. */
  strokeCount?: number;
  /** Whether a confident wrong guess appeared before the correct one. */
  misdirected?: boolean;
};

export type PlayerState = {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  score: number;
  promptIndex: number;
  completedPrompts: string[];
  lastSeen: number;
};

export type RoomChatMessage = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  sentAt: number;
};

export type GameState = {
  roomId: string;
  phase: GamePhase;
  players: PlayerState[];
  spectators: number;
  chatMessages: RoomChatMessage[];
  prompts: string[];
  mode: GameMode;
  maxPlayers: number;
  roundDurationMs: number;
  serverNow: number;
  countdownStartedAt?: number;
  startedAt?: number;
  endsAt?: number;
  winnerId?: string | null;
};

export type ClientMessage =
  | {
      type: "join";
      playerId: string;
      name: string;
    }
  | {
      type: "ready";
      playerId: string;
      ready: boolean;
    }
  | {
      type: "updateSettings";
      playerId: string;
      maxPlayers?: number;
      roundDurationMs?: number;
      mode?: GameMode;
    }
  | {
      type: "deleteLobby";
      playerId: string;
    }
  | {
      type: "sendChat";
      playerId: string;
      text: string;
    }
  | {
      type: "completePrompt";
      playerId: string;
      prompt: string;
      confidence: number;
      predictions: Prediction[];
      strokeCount?: number;
      misdirected?: boolean;
    }
  | {
      type: "skipPrompt";
      playerId: string;
      prompt: string;
    }
  | {
      type: "reset";
      playerId: string;
    };

export type ServerMessage =
  | {
      type: "state";
      state: GameState;
      playerId?: string;
      spectator?: boolean;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "lobbyDeleted";
    };

export function normalizeLabel(label: string) {
  return label.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}

export function isRecognizedPrompt(
  prompt: string,
  predictions: Prediction[],
  minConfidence = RECOGNITION_CONFIDENCE,
  topN = RECOGNITION_TOP_N,
) {
  const normalizedPrompt = normalizeLabel(prompt);
  return predictions.slice(0, topN).some((prediction) => {
    return (
      normalizeLabel(prediction.label) === normalizedPrompt &&
      prediction.confidence >= minConfidence
    );
  });
}

export function getWinnerId(players: PlayerState[]) {
  if (players.length === 0) {
    return null;
  }

  const sorted = [...players].sort((a, b) => b.score - a.score);
  if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
    return null;
  }

  return sorted[0].id;
}

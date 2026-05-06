export const MAX_PLAYERS = 2;
export const COUNTDOWN_MS = 3_000;
export const ROUND_DURATION_MS = 90_000;
export const RECOGNITION_CONFIDENCE = 0.72;
export const RECOGNITION_TOP_N = 3;

export type GamePhase = "waiting" | "countdown" | "playing" | "finished";

export type Prediction = {
  label: string;
  confidence: number;
};

export type PlayerState = {
  id: string;
  name: string;
  slot: 0 | 1;
  ready: boolean;
  connected: boolean;
  score: number;
  promptIndex: number;
  completedPrompts: string[];
  lastSeen: number;
};

export type GameState = {
  roomId: string;
  phase: GamePhase;
  players: PlayerState[];
  spectators: number;
  prompts: string[];
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
      type: "completePrompt";
      playerId: string;
      prompt: string;
      confidence: number;
      predictions: Prediction[];
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

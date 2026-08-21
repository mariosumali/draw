export const GAME_MODE_IDS = ["sprint", "minimal", "misdirection"] as const;

export type GameMode = (typeof GAME_MODE_IDS)[number];

export type GameModeDefinition = {
  id: GameMode;
  name: string;
  eyebrow: string;
  tagline: string;
  rules: string;
  scoring: string;
};

export const DEFAULT_GAME_MODE: GameMode = "sprint";
export const MISDIRECTION_CONFIDENCE = 0.35;

export const GAME_MODES: readonly GameModeDefinition[] = [
  {
    id: "sprint",
    name: "Speed Run",
    eyebrow: "Race",
    tagline: "Solve as many prompts as you can.",
    rules: "Draw fast, bank the match, and move immediately to the next card.",
    scoring: "100 points for every prompt the AI recognizes.",
  },
  {
    id: "minimal",
    name: "Ink Golf",
    eyebrow: "Precision",
    tagline: "Make the AI understand with fewer strokes.",
    rules: "Every pen-down counts. Undo removes the last stroke before you land the answer.",
    scoring: "Up to 850 points. Extra strokes steadily lower the award.",
  },
  {
    id: "misdirection",
    name: "Double Take",
    eyebrow: "Misdirection",
    tagline: "Fool the AI, then transform the sketch.",
    rules: "First earn a confident wrong guess, then turn that same drawing into the real prompt.",
    scoring: "400 points for solving, plus 400 when the wrong-guess trick lands first.",
  },
] as const;

export type PromptScoreInput = {
  confidence: number;
  strokeCount: number;
  misdirected: boolean;
};

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && GAME_MODE_IDS.includes(value as GameMode);
}

export function getGameModeDefinition(mode: GameMode = DEFAULT_GAME_MODE) {
  return GAME_MODES.find((candidate) => candidate.id === mode) ?? GAME_MODES[0];
}

export function scorePrompt(mode: GameMode, input: PromptScoreInput) {
  const confidence = clamp(input.confidence, 0, 1);
  const strokeCount = clamp(Math.round(input.strokeCount), 1, 99);

  if (mode === "minimal") {
    return clamp(Math.round(750 - (strokeCount - 1) * 55 + confidence * 100), 150, 850);
  }

  if (mode === "misdirection") {
    return 400 + (input.misdirected ? 400 : 0);
  }

  return 100;
}

export function scoreUnit(mode: GameMode) {
  return mode === "sprint" ? "solves" : "points";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

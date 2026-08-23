import { createPromptDeck } from "@/lib/game/prompts";

export const EXPERIENCE_IDS = ["party", "daily", "telephone", "hacker", "gallery"] as const;

export type GameExperience = (typeof EXPERIENCE_IDS)[number];

export type ExperienceDefinition = {
  id: GameExperience;
  name: string;
  eyebrow: string;
  tagline: string;
  description: string;
  href: string;
  players: string;
  accent: string;
};

export const GAME_EXPERIENCES: readonly ExperienceDefinition[] = [
  {
    id: "party",
    name: "Party Show",
    eyebrow: "Main event",
    tagline: "Five rounds. Three rules. One ridiculous reveal.",
    description: "Race together, compare every sketch, and watch the AI's wrong turns become the punchline.",
    href: "/",
    players: "2–6 players",
    accent: "#e53935",
  },
  {
    id: "daily",
    name: "Daily Gauntlet",
    eyebrow: "Every day",
    tagline: "Six shared prompts and only three lives.",
    description: "Chase a seeded daily score, protect your streak, and come back tomorrow for a fresh run.",
    href: "/play/daily",
    players: "Solo",
    accent: "#d88700",
  },
  {
    id: "telephone",
    name: "AI Telephone",
    eyebrow: "Meaning mutates",
    tagline: "Draw it. Let the AI rename it. Draw that next.",
    description: "Build a four-link chain and reveal how far the original idea drifted.",
    href: "/play/telephone",
    players: "Solo lab",
    accent: "#5f8fb4",
  },
  {
    id: "hacker",
    name: "Model Hacker",
    eyebrow: "Boss puzzles",
    tagline: "Make the AI say the decoy, then land the truth.",
    description: "Solve curated wrong-then-right drawing challenges without clearing the canvas.",
    href: "/play/hacker",
    players: "Solo challenge",
    accent: "#8a5fa8",
  },
  {
    id: "gallery",
    name: "Creative Gallery",
    eyebrow: "No clock",
    tagline: "Make, title, save, and remix at your own pace.",
    description: "Use the live guesses as creative prompts, then keep a local collection of your favorite sketches.",
    href: "/play/gallery",
    players: "Creative sandbox",
    accent: "#5f946a",
  },
] as const;

export type HackerChallenge = {
  prompt: string;
  decoy: string;
  hint: string;
};

export const HACKER_CHALLENGES: readonly HackerChallenge[] = [
  { prompt: "cat", decoy: "lion", hint: "Start wild, then add domestic details." },
  { prompt: "mug", decoy: "bucket", hint: "Scale is imaginary. Handles are everything." },
  { prompt: "airplane", decoy: "bird", hint: "Begin organic, then engineer the wings." },
  { prompt: "clock", decoy: "sun", hint: "Rays first; hands and numbers second." },
  { prompt: "truck", decoy: "bus", hint: "Build one long vehicle, then reveal the bed." },
] as const;

export function getDailyKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createDailyPrompts(date = new Date(), count = 6) {
  return createPromptDeck(`daily-${getDailyKey(date)}`, count);
}

export function scoreDailyPrompt(remainingMs: number, confidence: number) {
  const timeBonus = Math.round(Math.max(0, Math.min(30_000, remainingMs)) / 75);
  const confidenceBonus = Math.round(Math.max(0, Math.min(1, confidence)) * 250);
  return 350 + timeBonus + confidenceBonus;
}

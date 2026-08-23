import { describe, expect, it } from "vitest";

import { createDailyPrompts, GAME_EXPERIENCES, getDailyKey, scoreDailyPrompt } from "@/lib/game/experiences";

describe("game experiences", () => {
  it("defines a route for every playable direction", () => {
    expect(GAME_EXPERIENCES.map((experience) => experience.id)).toEqual([
      "party",
      "daily",
      "telephone",
      "hacker",
      "gallery",
    ]);
  });

  it("creates a deterministic daily deck", () => {
    const date = new Date(2026, 7, 23);
    expect(getDailyKey(date)).toBe("2026-08-23");
    expect(createDailyPrompts(date)).toEqual(createDailyPrompts(date));
    expect(createDailyPrompts(date)).toHaveLength(6);
  });

  it("rewards faster, more confident daily solves", () => {
    expect(scoreDailyPrompt(25_000, 0.9)).toBeGreaterThan(scoreDailyPrompt(5_000, 0.5));
    expect(scoreDailyPrompt(-1, 4)).toBe(600);
  });
});

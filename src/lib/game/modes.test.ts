import { describe, expect, it } from "vitest";

import { getGameModeDefinition, getRoundMode, isGameMode, scorePrompt } from "@/lib/game/modes";

describe("game modes", () => {
  it("recognizes only supported mode identifiers", () => {
    expect(isGameMode("sprint")).toBe(true);
    expect(isGameMode("minimal")).toBe(true);
    expect(isGameMode("misdirection")).toBe(true);
    expect(isGameMode("classic")).toBe(false);
  });

  it("keeps sprint scoring flat so throughput wins", () => {
    expect(scorePrompt("sprint", input({ strokeCount: 1 }))).toBe(100);
    expect(scorePrompt("sprint", input({ strokeCount: 20 }))).toBe(100);
  });

  it("rewards low-stroke solutions in Ink Golf", () => {
    const oneStroke = scorePrompt("minimal", input({ strokeCount: 1 }));
    const eightStrokes = scorePrompt("minimal", input({ strokeCount: 8 }));

    expect(oneStroke).toBeGreaterThan(eightStrokes);
    expect(oneStroke).toBeLessThanOrEqual(850);
    expect(eightStrokes).toBeGreaterThanOrEqual(150);
  });

  it("doubles a Double Take solve after a confident misdirection", () => {
    expect(scorePrompt("misdirection", input({ misdirected: false }))).toBe(400);
    expect(scorePrompt("misdirection", input({ misdirected: true }))).toBe(800);
  });

  it("falls back to the default definition", () => {
    expect(getGameModeDefinition().id).toBe("sprint");
  });

  it("rotates party rules beginning with the host's selection", () => {
    expect(getRoundMode("minimal", 0)).toBe("minimal");
    expect(getRoundMode("minimal", 1)).toBe("misdirection");
    expect(getRoundMode("minimal", 2)).toBe("sprint");
    expect(getRoundMode("minimal", 3)).toBe("minimal");
  });
});

function input(overrides: Partial<Parameters<typeof scorePrompt>[1]> = {}) {
  return {
    confidence: 0.6,
    strokeCount: 5,
    misdirected: false,
    ...overrides,
  };
}

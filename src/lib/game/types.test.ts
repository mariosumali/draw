import { describe, expect, it } from "vitest";

import { getWinnerId, isRecognizedPrompt, type PlayerState } from "@/lib/game/types";

describe("isRecognizedPrompt", () => {
  it("accepts matching labels inside the top N above threshold", () => {
    expect(
      isRecognizedPrompt("alarm clock", [
        { label: "circle", confidence: 0.91 },
        { label: "alarm_clock", confidence: 0.74 },
      ]),
    ).toBe(true);
  });

  it("rejects low-confidence matches", () => {
    expect(isRecognizedPrompt("cat", [{ label: "cat", confidence: 0.3 }])).toBe(false);
  });
});

describe("getWinnerId", () => {
  it("returns null for ties", () => {
    expect(getWinnerId([player("a", 3), player("b", 3)])).toBeNull();
  });

  it("returns the highest scoring player", () => {
    expect(getWinnerId([player("a", 2), player("b", 4)])).toBe("b");
  });
});

function player(id: string, score: number): PlayerState {
  return {
    id,
    score,
    name: id,
    slot: id === "a" ? 0 : 1,
    ready: true,
    connected: true,
    promptIndex: score,
    completedPrompts: [],
    roundDone: false,
    lastAward: 0,
    lastSeen: 0,
  };
}

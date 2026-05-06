import { describe, expect, it } from "vitest";

import { createPromptDeck } from "@/lib/game/prompts";

describe("createPromptDeck", () => {
  it("creates deterministic prompt order for the same room id", () => {
    expect(createPromptDeck("room-a", 8)).toEqual(createPromptDeck("room-a", 8));
  });

  it("changes prompt order across room ids", () => {
    expect(createPromptDeck("room-a", 8)).not.toEqual(createPromptDeck("room-b", 8));
  });
});

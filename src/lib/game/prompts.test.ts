import { describe, expect, it } from "vitest";

import { QUICK_DRAW_CATEGORY_COUNT } from "@/lib/game/quickdraw-categories";
import { createPromptDeck } from "@/lib/game/prompts";

describe("createPromptDeck", () => {
  it("draws prompts from the full Quick Draw category list", () => {
    expect(QUICK_DRAW_CATEGORY_COUNT).toBe(345);
    expect(createPromptDeck("room-a", 18).length).toBe(18);
  });

  it("creates deterministic prompt order for the same room id", () => {
    expect(createPromptDeck("room-a", 8)).toEqual(createPromptDeck("room-a", 8));
  });

  it("changes prompt order across room ids", () => {
    expect(createPromptDeck("room-a", 8)).not.toEqual(createPromptDeck("room-b", 8));
  });
});

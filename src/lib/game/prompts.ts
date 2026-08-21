import { QUICK_DRAW_CATEGORIES } from "@/lib/game/quickdraw-categories";

export const QUICK_DRAW_PROMPTS = QUICK_DRAW_CATEGORIES;

export const QUICK_DRAW_CATEGORIES_URL =
  "https://raw.githubusercontent.com/googlecreativelab/quickdraw-dataset/master/categories.txt";

export function createPromptDeck(roomId: string, count = 18) {
  const prompts = [...QUICK_DRAW_CATEGORIES];
  let seed = hashRoomId(roomId);

  for (let index = prompts.length - 1; index > 0; index -= 1) {
    seed = nextSeed(seed);
    const swapIndex = seed % (index + 1);
    [prompts[index], prompts[swapIndex]] = [prompts[swapIndex], prompts[index]];
  }

  return prompts.slice(0, Math.min(count, prompts.length));
}

function hashRoomId(roomId: string) {
  let hash = 2166136261;
  for (let index = 0; index < roomId.length; index += 1) {
    hash ^= roomId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeed(seed: number) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

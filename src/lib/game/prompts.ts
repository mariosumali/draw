export const QUICK_DRAW_PROMPTS = [
  "apple",
  "airplane",
  "bicycle",
  "sailboat",
  "book",
  "butterfly",
  "car",
  "cat",
  "chair",
  "cloud",
  "crown",
  "cup",
  "dog",
  "eye",
  "fish",
  "flower",
  "guitar",
  "house",
  "key",
  "ladder",
  "moon",
  "mountain",
  "mushroom",
  "pencil",
  "pizza",
  "rabbit",
  "snake",
  "star",
  "sun",
  "tree",
  "umbrella",
] as const;

export function createPromptDeck(roomId: string, count = 18) {
  const prompts = [...QUICK_DRAW_PROMPTS];
  let seed = hashRoomId(roomId);

  for (let index = prompts.length - 1; index > 0; index -= 1) {
    seed = nextSeed(seed);
    const swapIndex = seed % (index + 1);
    [prompts[index], prompts[swapIndex]] = [prompts[swapIndex], prompts[index]];
  }

  return prompts.slice(0, count);
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

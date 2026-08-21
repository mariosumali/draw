import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGuessNarration, type UseGuessNarrationOptions } from "@/hooks/useGuessNarration";
import { SoundEngine } from "@/lib/audio/sound-engine";
import { VoiceNarrator } from "@/lib/audio/voice";
import { VoiceSettingsStore } from "@/lib/audio/voice-settings";
import type { AnimatedGuessSnapshot } from "@/hooks/useAnimatedGuesses";
import type { Prediction } from "@/lib/game/types";

class FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

let spoken: FakeUtterance[] = [];

function installSpeechSynthesis() {
  spoken = [];
  const synth = {
    // Settle synchronously so each line is spoken rather than queued behind
    // the previous one — queue behaviour is covered in voice.test.ts.
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
      utterance.onend?.();
    },
    cancel: () => {},
    getVoices: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true, writable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeUtterance,
    configurable: true,
    writable: true,
  });
}

/** Text of everything said, minus the silent iOS priming utterance. */
function said() {
  return spoken.map((utterance) => utterance.text).filter((text) => text.trim().length > 0);
}

function snapshot(overrides: Partial<AnimatedGuessSnapshot> = {}): AnimatedGuessSnapshot {
  return {
    status: "idle",
    visiblePredictions: [],
    activePrediction: null,
    topPredictions: [],
    signature: "",
    exhausted: false,
    ...overrides,
  };
}

/** Snapshot for "the recognizer just revealed guess #index". */
function reveal(predictions: Prediction[], index: number, signature = "sig"): AnimatedGuessSnapshot {
  const visible = predictions.slice(0, index + 1);
  const isLast = index === predictions.length - 1;
  return snapshot({
    status: isLast ? "complete" : "revealing",
    visiblePredictions: visible,
    activePrediction: predictions[index] ?? null,
    topPredictions: predictions,
    signature,
    exhausted: isLast,
  });
}

let container: HTMLDivElement;
let root: Root;

// Declared once: a fresh component type per render would remount and wipe the
// hook's repeat-suppression refs.
function Harness(props: UseGuessNarrationOptions) {
  useGuessNarration(props);
  return null;
}

function render(options: UseGuessNarrationOptions) {
  act(() => {
    root.render(createElement(Harness, options));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  VoiceSettingsStore.__resetForTests();
  VoiceNarrator.__resetForTests();
  SoundEngine.unmute();
  installSpeechSynthesis();

  container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  VoiceNarrator.__resetForTests();
  vi.useRealTimers();
});

const CAT: Prediction[] = [
  { label: "cat", confidence: 0.52 },
  { label: "dog", confidence: 0.21 },
  { label: "rabbit", confidence: 0.09 },
];

describe("useGuessNarration", () => {
  it("thinks out loud before it has a guess", () => {
    render({ guessState: snapshot({ status: "thinking", signature: "sig" }) });

    expect(said()).toHaveLength(1);
  });

  it("stays quiet during thinking on the quiet setting", () => {
    VoiceSettingsStore.set({ chattiness: "quiet" });
    render({ guessState: snapshot({ status: "thinking", signature: "sig" }) });

    expect(said()).toEqual([]);
  });

  it("names each guess as it is revealed", () => {
    render({ guessState: reveal(CAT, 0) });
    expect(said().join(" ")).toContain("a cat");

    render({ guessState: reveal(CAT, 1) });
    expect(said().join(" ")).toContain("a dog");
  });

  it("stops after the chattiness budget instead of reading the whole list", () => {
    VoiceSettingsStore.set({ chattiness: "normal" });

    render({ guessState: reveal(CAT, 0) });
    render({ guessState: reveal(CAT, 1) });
    render({ guessState: reveal(CAT, 2) });

    expect(said().join(" ")).not.toContain("a rabbit");
  });

  it("reads the whole list when chatty", () => {
    VoiceSettingsStore.set({ chattiness: "chatty" });

    render({ guessState: reveal(CAT, 0) });
    render({ guessState: reveal(CAT, 1) });
    render({ guessState: reveal(CAT, 2) });

    expect(said().join(" ")).toContain("a rabbit");
  });

  it("does not repeat a guess it already made for the same sketch", () => {
    render({ guessState: reveal(CAT, 0, "sig-1") });
    const first = said().length;

    render({ guessState: reveal(CAT, 0, "sig-2") });
    expect(said()).toHaveLength(first);
  });

  it("celebrates once when it recognizes the prompt", () => {
    render({ guessState: reveal(CAT, 0), prompt: "cat" });

    expect(said().join(" ")).toMatch(/cat!/);
    const afterFirst = said().length;

    render({ guessState: reveal(CAT, 0, "sig-again"), prompt: "cat" });
    expect(said()).toHaveLength(afterFirst);
  });

  it("celebrates a matching model result without waiting for the visual reveal queue", () => {
    const predictions: Prediction[] = [
      { label: "dog", confidence: 0.64 },
      { label: "cat", confidence: 0.52 },
    ];

    render({
      guessState: snapshot({ status: "thinking", signature: "dog:12|cat:10" }),
      predictions,
      prompt: "cat",
    });

    expect(said().join(" ")).toMatch(/cat!/);
  });

  it("does not celebrate a low-confidence match", () => {
    const weak: Prediction[] = [{ label: "cat", confidence: 0.2 }];
    render({ guessState: reveal(weak, 0), prompt: "cat" });

    expect(said().join(" ")).not.toContain("!");
  });

  it("says its top guess again once the repeat cooldown lapses", () => {
    vi.useFakeTimers();

    render({ guessState: reveal(CAT, 0, "sig-1") });
    expect(said()).toHaveLength(1);

    vi.advanceTimersByTime(10_000);
    render({ guessState: reveal(CAT, 0, "sig-2") });

    expect(said()).toHaveLength(2);
    vi.useRealTimers();
  });

  it("admits defeat when the guesses run out", () => {
    VoiceSettingsStore.set({ chattiness: "quiet" });
    render({ guessState: reveal(CAT, 2), prompt: "boat" });
    expect(said()).toEqual([]);

    VoiceSettingsStore.set({ chattiness: "normal" });
    render({ guessState: reveal(CAT, 2, "sig-2"), prompt: "boat" });
    expect(said().length).toBeGreaterThan(0);
  });

  it("never gives up when there is no word to guess", () => {
    render({ guessState: reveal(CAT, 0) });
    render({ guessState: reveal(CAT, 1) });
    render({ guessState: reveal(CAT, 2) });

    expect(said().join(" ")).not.toMatch(/stumped|no idea|can't tell|lost|got me/i);
  });

  it("starts fresh on the next prompt", () => {
    render({ guessState: reveal(CAT, 0), prompt: "boat", resetKey: "0:boat" });
    const first = said().length;

    render({ guessState: snapshot(), prompt: "car", resetKey: "1:car" });
    render({ guessState: reveal(CAT, 0), prompt: "car", resetKey: "1:car" });

    expect(said().length).toBeGreaterThan(first);
  });

  it("announces the prompt only when chatty and asked to", () => {
    render({ guessState: snapshot(), prompt: "sleepy robot", resetKey: "0", announcePrompt: true });
    expect(said()).toEqual([]);

    VoiceSettingsStore.set({ chattiness: "chatty" });
    render({ guessState: snapshot(), prompt: "sleepy robot", resetKey: "0", announcePrompt: true });
    expect(said().join(" ")).toContain("a sleepy robot");
  });

  it("says nothing while inactive", () => {
    render({ guessState: reveal(CAT, 0), prompt: "cat", active: false });

    expect(said()).toEqual([]);
  });

  it("says nothing when the voice is switched off", () => {
    VoiceSettingsStore.set({ enabled: false });
    render({ guessState: reveal(CAT, 0), prompt: "cat" });

    expect(said()).toEqual([]);
  });

  it("says nothing while the game is muted", () => {
    SoundEngine.mute();
    render({ guessState: reveal(CAT, 0), prompt: "cat" });

    expect(said()).toEqual([]);
    SoundEngine.unmute();
  });
});

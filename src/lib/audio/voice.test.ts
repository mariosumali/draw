import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNarrationLine, type NarrationLine } from "@/lib/audio/narration";
import { SoundEngine } from "@/lib/audio/sound-engine";
import { VoiceNarrator, type VoiceStatus } from "@/lib/audio/voice";
import { VOICE_RATE_RANGE, VoiceSettingsStore } from "@/lib/audio/voice-settings";

class FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event?: SpeechSynthesisErrorEvent) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

function fakeVoice(name: string, lang: string, localService = true) {
  return { name, lang, voiceURI: `urn:${name}`, localService, default: false } as SpeechSynthesisVoice;
}

const VOICES = [
  fakeVoice("Daniel", "en-GB"),
  fakeVoice("Google US English", "en-US", false),
  fakeVoice("Amelie", "fr-FR"),
];

let spoken: FakeUtterance[] = [];
let cancelCount = 0;

function installSpeechSynthesis(voices = VOICES) {
  spoken = [];
  cancelCount = 0;

  const target = new EventTarget();
  const synth = {
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
    },
    cancel: () => {
      cancelCount += 1;
    },
    getVoices: () => voices,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };

  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true, writable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeUtterance,
    configurable: true,
    writable: true,
  });
}

function removeSpeechSynthesis() {
  Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true, writable: true });
}

/** Utterances the narrator actually queued, ignoring the silent priming one. */
function spokenTexts() {
  return spoken.map((utterance) => utterance.text).filter((text) => text.trim().length > 0);
}

function line(overrides: Partial<NarrationLine> & Pick<NarrationLine, "text" | "priority">): NarrationLine {
  return {
    kind: "guess",
    rateScale: 1,
    pitchScale: 1,
    dedupeKey: overrides.text,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  VoiceSettingsStore.__resetForTests();
  VoiceNarrator.__resetForTests();
  SoundEngine.unmute();
  installSpeechSynthesis();
});

afterEach(() => {
  VoiceNarrator.__resetForTests();
  vi.useRealTimers();
});

describe("support detection", () => {
  it("reports unsupported and stays silent without the Web Speech API", () => {
    removeSpeechSynthesis();
    VoiceNarrator.__resetForTests();

    expect(VoiceNarrator.isSupported()).toBe(false);
    expect(VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }))).toBe(false);
    expect(VoiceNarrator.getVoices()).toEqual([]);
  });

  it("exposes installed voices as plain data", () => {
    expect(VoiceNarrator.getVoices().map((voice) => voice.name)).toEqual([
      "Daniel",
      "Google US English",
      "Amelie",
    ]);
    expect(VoiceNarrator.getVoices().map((voice) => voice.isLocal)).toEqual([true, false, true]);
  });
});

describe("gating", () => {
  it("stays silent when the voice is turned off", () => {
    VoiceSettingsStore.set({ enabled: false });

    expect(VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }))).toBe(false);
    expect(spokenTexts()).toEqual([]);
  });

  it("stays silent while the game is muted", () => {
    SoundEngine.mute();

    expect(VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }))).toBe(false);

    SoundEngine.unmute();
    expect(VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }))).toBe(true);
  });

  it("cuts off mid-sentence when the game is muted", () => {
    VoiceNarrator.speak(line({ text: "a long guess", priority: "normal" }));
    const before = cancelCount;

    SoundEngine.mute();
    expect(cancelCount).toBeGreaterThan(before);
    SoundEngine.unmute();
  });

  it("cuts off mid-sentence when the voice is switched off", () => {
    VoiceNarrator.speak(line({ text: "a long guess", priority: "normal" }));
    const before = cancelCount;

    VoiceSettingsStore.set({ enabled: false });
    expect(cancelCount).toBeGreaterThan(before);
  });
});

describe("utterance settings", () => {
  it("applies the listener's settings scaled by the line's prosody", () => {
    VoiceSettingsStore.set({ rate: 1, pitch: 1, volume: 0.5 });
    VoiceNarrator.speak(buildNarrationLine({ kind: "recognized", label: "cat", seed: "s" }));

    const utterance = spoken.at(-1)!;
    expect(utterance.rate).toBeCloseTo(1.14, 5);
    expect(utterance.pitch).toBeCloseTo(1.14, 5);
    expect(utterance.volume).toBe(0.5);
  });

  it("clamps scaled values into the supported range", () => {
    VoiceSettingsStore.set({ rate: VOICE_RATE_RANGE.max });
    VoiceNarrator.speak(line({ text: "fast", priority: "normal", rateScale: 4 }));

    expect(spoken.at(-1)!.rate).toBe(VOICE_RATE_RANGE.max);
  });

  it("prefers a dependable local English voice when none is chosen", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));

    expect(spoken.at(-1)!.voice?.name).toBe("Daniel");
    expect(spoken.at(-1)!.lang).toBe("en-GB");
  });

  it("honours an explicitly chosen voice", () => {
    VoiceSettingsStore.set({ voiceURI: "urn:Amelie" });
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));

    expect(spoken.at(-1)!.voice?.name).toBe("Amelie");
  });

  it("falls back to an English voice when the saved one is gone", () => {
    VoiceSettingsStore.set({ voiceURI: "urn:Uninstalled" });
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));

    expect(spoken.at(-1)!.voice?.name).toBe("Daniel");
  });

  it("retries a failing selected voice with a local fallback", () => {
    vi.useFakeTimers();
    VoiceSettingsStore.set({ voiceURI: "urn:Google US English" });
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));

    expect(spoken.at(-1)!.voice?.name).toBe("Google US English");
    spoken.at(-1)!.onerror?.({ error: "network" } as SpeechSynthesisErrorEvent);
    vi.advanceTimersByTime(60);

    expect(spokenTexts()).toEqual(["a cat?", "a cat?"]);
    expect(spoken.at(-1)!.voice?.name).toBe("Daniel");
    expect(VoiceNarrator.getHistory().map((entry) => entry.text)).toEqual(["a cat?"]);
    expect(VoiceNarrator.getFallbackNotice()).toBe(
      "Google US English could not play. Using Daniel instead.",
    );
  });

  it("reports failure after the fallback voice also fails", () => {
    vi.useFakeTimers();
    VoiceSettingsStore.set({ voiceURI: "urn:Google US English" });
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    spoken.at(-1)!.onerror?.({ error: "network" } as SpeechSynthesisErrorEvent);
    vi.advanceTimersByTime(60);

    spoken.at(-1)!.onerror?.({ error: "synthesis-failed" } as SpeechSynthesisErrorEvent);
    expect(VoiceNarrator.getStatus()).toBe("failed");
  });
});

describe("queueing and priority", () => {
  it("drops filler while something is already being said", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    expect(VoiceNarrator.speak(line({ text: "Hmm...", priority: "low" }))).toBe(false);

    expect(spokenTexts()).toEqual(["a cat?"]);
  });

  it("lets a real guess cut in over filler", () => {
    VoiceNarrator.speak(line({ text: "Hmm...", priority: "low" }));
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));

    expect(cancelCount).toBe(1);
    expect(spokenTexts()).toEqual(["Hmm...", "a cat?"]);
  });

  it("queues follow-up guesses and speaks them when the previous one ends", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "or a dog?", priority: "normal" }));

    expect(spokenTexts()).toEqual(["a cat?"]);

    spoken.at(-1)!.onend?.();
    expect(spokenTexts()).toEqual(["a cat?", "or a dog?"]);
  });

  it("caps the backlog so the voice never falls behind the sketch", () => {
    VoiceNarrator.speak(line({ text: "first", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "second", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "third", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "fourth", priority: "normal" }));

    spoken.at(-1)!.onend?.();
    spoken.at(-1)!.onend?.();
    spoken.at(-1)!.onend?.();

    expect(spokenTexts()).toEqual(["first", "third", "fourth"]);
  });

  it("interrupts everything for the recognition payoff", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "or a dog?", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "Oh, I know! It's a boat!", priority: "high" }));

    expect(spokenTexts()).toEqual(["a cat?", "Oh, I know! It's a boat!"]);

    spoken.at(-1)!.onend?.();
    expect(spokenTexts()).toEqual(["a cat?", "Oh, I know! It's a boat!"]);
  });

  it("does not cancel the native engine when a high-priority line starts from idle", () => {
    VoiceNarrator.speak(line({ text: "Oh, I know!", priority: "high" }));

    expect(cancelCount).toBe(0);
    expect(spokenTexts()).toEqual(["Oh, I know!"]);
  });

  it("advances the queue when an utterance errors", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "or a dog?", priority: "normal" }));

    spoken.at(-1)!.onerror?.();
    expect(spokenTexts()).toEqual(["a cat?", "or a dog?"]);
  });

  it("keeps moving when the engine never fires onend", () => {
    vi.useFakeTimers();
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "or a dog?", priority: "normal" }));

    vi.advanceTimersByTime(60_000);
    expect(spokenTexts()).toEqual(["a cat?", "or a dog?"]);
  });
});

describe("cancelChatter", () => {
  it("clears pending guesses when the prompt rolls over", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "or a dog?", priority: "normal" }));

    VoiceNarrator.cancelChatter();
    expect(cancelCount).toBe(1);

    VoiceNarrator.speak(line({ text: "next word", priority: "normal" }));
    expect(spokenTexts()).toEqual(["a cat?", "next word"]);
  });

  it("lets an in-flight payoff line finish", () => {
    VoiceNarrator.speak(line({ text: "Oh, I know! It's a boat!", priority: "high" }));
    VoiceNarrator.cancelChatter();

    expect(cancelCount).toBe(0);
    expect(spokenTexts()).toEqual(["Oh, I know! It's a boat!"]);
  });
});

describe("dedupe", () => {
  it("skips a repeat of the same guess inside the cooldown", () => {
    const guess = buildNarrationLine({ kind: "guess", label: "cat", index: 0, confidence: 0.4, seed: "a" });
    const sameLabel = buildNarrationLine({ kind: "guess", label: "cat", index: 0, confidence: 0.5, seed: "b" });

    expect(VoiceNarrator.speak(guess, { dedupeMs: 5_000 })).toBe(true);
    expect(VoiceNarrator.speak(sameLabel, { dedupeMs: 5_000 })).toBe(false);
  });

  it("allows the repeat again once the cooldown has passed", () => {
    vi.useFakeTimers();
    const guess = buildNarrationLine({ kind: "guess", label: "cat", index: 0, confidence: 0.4, seed: "a" });

    expect(VoiceNarrator.speak(guess, { dedupeMs: 5_000 })).toBe(true);
    vi.advanceTimersByTime(6_000);
    expect(VoiceNarrator.speak(guess, { dedupeMs: 5_000 })).toBe(true);
  });

  it("does not dedupe different labels", () => {
    const cat = buildNarrationLine({ kind: "guess", label: "cat", index: 0, confidence: 0.4, seed: "a" });
    const dog = buildNarrationLine({ kind: "guess", label: "dog", index: 1, confidence: 0.3, seed: "a" });

    expect(VoiceNarrator.speak(cat, { dedupeMs: 5_000 })).toBe(true);
    expect(VoiceNarrator.speak(dog, { dedupeMs: 5_000 })).toBe(true);
  });
});

describe("speakScript", () => {
  const SCRIPT = [
    line({ text: "Hmm...", priority: "low", kind: "thinking" }),
    line({ text: "a cat?", priority: "normal" }),
    line({ text: "or a dog?", priority: "normal" }),
    line({ text: "Oh, I know! It's a boat!", priority: "high", kind: "recognized" }),
  ];

  it("says every line in order, past the live queue cap", () => {
    expect(VoiceNarrator.speakScript(SCRIPT)).toBe(true);
    expect(spokenTexts()).toEqual(["Hmm..."]);

    for (let index = 0; index < SCRIPT.length; index += 1) {
      spoken.at(-1)!.onend?.();
    }

    expect(spokenTexts()).toEqual(SCRIPT.map((entry) => entry.text));
  });

  it("replaces whatever was already playing", () => {
    VoiceNarrator.speak(line({ text: "stale guess", priority: "normal" }));
    VoiceNarrator.speakScript(SCRIPT);

    expect(cancelCount).toBe(1);
    expect(spokenTexts()).toEqual(["stale guess", "Hmm..."]);
  });

  it("refuses an empty script or a silenced voice", () => {
    expect(VoiceNarrator.speakScript([])).toBe(false);

    VoiceSettingsStore.set({ enabled: false });
    expect(VoiceNarrator.speakScript(SCRIPT)).toBe(false);
  });
});

describe("transcript", () => {
  it("records lines as they are actually spoken, tagged with their source", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }), { source: "ONNX" });
    VoiceNarrator.speak(line({ text: "or a dog?", priority: "normal" }), { source: "MobileViT" });

    expect(VoiceNarrator.getHistory().map((entry) => [entry.text, entry.source])).toEqual([
      ["a cat?", "ONNX"],
    ]);

    spoken.at(-1)!.onend?.();
    expect(VoiceNarrator.getHistory().map((entry) => [entry.text, entry.source])).toEqual([
      ["a cat?", "ONNX"],
      ["or a dog?", "MobileViT"],
    ]);
  });

  it("does not record a line the queue never played", () => {
    VoiceNarrator.speak(line({ text: "first", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "second", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "third", priority: "normal" }));
    VoiceNarrator.speak(line({ text: "fourth", priority: "normal" }));

    spoken.at(-1)!.onend?.();
    spoken.at(-1)!.onend?.();
    spoken.at(-1)!.onend?.();

    expect(VoiceNarrator.getHistory().map((entry) => entry.text)).toEqual(["first", "third", "fourth"]);
  });

  it("notifies subscribers and keeps a stable snapshot between changes", () => {
    const listener = vi.fn();
    const unsubscribe = VoiceNarrator.subscribeHistory(listener);
    const before = VoiceNarrator.getHistory();

    expect(VoiceNarrator.getHistory()).toBe(before);

    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(VoiceNarrator.getHistory()).not.toBe(before);

    unsubscribe();
  });

  it("clears on request, and clearing an empty transcript is a no-op", () => {
    const listener = vi.fn();
    const unsubscribe = VoiceNarrator.subscribeHistory(listener);

    VoiceNarrator.clearHistory();
    expect(listener).not.toHaveBeenCalled();

    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    VoiceNarrator.clearHistory();

    expect(VoiceNarrator.getHistory()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("keeps only the most recent lines", () => {
    for (let index = 0; index < 24; index += 1) {
      VoiceNarrator.speak(line({ text: `line ${index}`, priority: "high" }));
    }

    const texts = VoiceNarrator.getHistory().map((entry) => entry.text);
    expect(texts).toHaveLength(16);
    expect(texts.at(-1)).toBe("line 23");
  });
});

describe("status", () => {
  it("is ready when supported, enabled, and unmuted", () => {
    expect(VoiceNarrator.getStatus()).toBe("ready");
  });

  it("reports the voice being switched off", () => {
    VoiceSettingsStore.set({ enabled: false });
    expect(VoiceNarrator.getStatus()).toBe("off");
  });

  it("reports the game mute, which is the silent killer", () => {
    SoundEngine.mute();
    expect(VoiceNarrator.getStatus()).toBe("muted");

    SoundEngine.unmute();
    expect(VoiceNarrator.getStatus()).toBe("ready");
  });

  it("reports a browser with no Web Speech API", () => {
    removeSpeechSynthesis();
    VoiceNarrator.__resetForTests();

    expect(VoiceNarrator.getStatus()).toBe("unsupported");
  });

  it("reports a system with no installed voices, but only once the list is final", () => {
    installSpeechSynthesis([]);
    VoiceNarrator.__resetForTests();
    installSpeechSynthesis([]);

    // An empty list before `voiceschanged` just means "still loading".
    expect(VoiceNarrator.getStatus()).toBe("ready");

    VoiceNarrator.getVoices();
    window.speechSynthesis.dispatchEvent(new Event("voiceschanged"));
    expect(VoiceNarrator.getStatus()).toBe("no-voices");
  });

  it("reports a browser that refused to speak, and clears it on the next gesture", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    spoken.at(-1)!.onerror?.({ error: "not-allowed" } as SpeechSynthesisErrorEvent);

    expect(VoiceNarrator.getStatus()).toBe("blocked");
    expect(VoiceNarrator.getLastError()).toBe("not-allowed");

    VoiceNarrator.prime();
    expect(VoiceNarrator.getStatus()).toBe("ready");
  });

  it("treats a deliberate interruption as normal, not a failure", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    spoken.at(-1)!.onerror?.({ error: "interrupted" } as SpeechSynthesisErrorEvent);

    expect(VoiceNarrator.getStatus()).toBe("ready");
  });

  it("separates an engine failure from a missing user gesture", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    spoken.at(-1)!.onerror?.({ error: "audio-hardware" } as SpeechSynthesisErrorEvent);

    const status: VoiceStatus = VoiceNarrator.getStatus();
    expect(status).toBe("failed");
  });

  it("clears a failure as soon as a line really starts", () => {
    VoiceNarrator.speak(line({ text: "a cat?", priority: "normal" }));
    spoken.at(-1)!.onerror?.({ error: "audio-hardware" } as SpeechSynthesisErrorEvent);
    expect(VoiceNarrator.getStatus()).toBe("failed");

    VoiceNarrator.speak(line({ text: "or a dog?", priority: "normal" }));
    spoken.at(-1)!.onstart?.();
    expect(VoiceNarrator.getStatus()).toBe("ready");
  });

  it("notifies subscribers when the reason for silence changes", () => {
    const listener = vi.fn();
    const unsubscribe = VoiceNarrator.subscribeStatus(listener);

    SoundEngine.mute();
    expect(listener).toHaveBeenCalled();

    SoundEngine.unmute();
    unsubscribe();
  });
});

describe("prime", () => {
  it("speaks one silent utterance so iOS unlocks the voice, and only once", () => {
    VoiceNarrator.prime();
    VoiceNarrator.prime();

    expect(spoken).toHaveLength(1);
    expect(spoken[0].volume).toBe(0);
  });

  it("is a no-op without the Web Speech API", () => {
    removeSpeechSynthesis();
    VoiceNarrator.__resetForTests();

    expect(() => VoiceNarrator.prime()).not.toThrow();
  });
});

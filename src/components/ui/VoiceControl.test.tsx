import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VoiceControl } from "@/components/ui/VoiceControl";
import { SoundEngine } from "@/lib/audio/sound-engine";
import { VoiceNarrator } from "@/lib/audio/voice";
import { DEFAULT_VOICE_SETTINGS, VoiceSettingsStore } from "@/lib/audio/voice-settings";

class FakeUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  volume = 1;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

const VOICE = {
  name: "Daniel",
  lang: "en-GB",
  voiceURI: "urn:Daniel",
  localService: true,
  default: true,
} as SpeechSynthesisVoice;

let spoken: FakeUtterance[] = [];
let container: HTMLDivElement;
let root: Root;

function installSpeechSynthesis() {
  spoken = [];
  const synth = {
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
      utterance.onstart?.();
      utterance.onend?.();
    },
    cancel: () => {},
    getVoices: () => [VOICE],
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

function buttonNamed(name: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === name,
  );
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
    root.render(<VoiceControl />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  VoiceNarrator.__resetForTests();
  SoundEngine.unmute();
});

describe("Hear it", () => {
  it("plays the selected voice", () => {
    act(() => {
      buttonNamed("Voice")?.click();
    });
    act(() => {
      buttonNamed("Hear it")?.click();
    });

    const preview = spoken.find((utterance) => utterance.text.trim().length > 0);
    expect(preview?.voice?.voiceURI).toBe("urn:Daniel");
  });

  it("repairs muted, disabled, and zero-volume states before previewing", () => {
    act(() => {
      SoundEngine.mute();
      VoiceSettingsStore.set({ enabled: false, volume: 0 });
      buttonNamed("Voice")?.click();
    });
    act(() => {
      buttonNamed("Hear it")?.click();
    });

    expect(SoundEngine.isMuted()).toBe(false);
    expect(VoiceSettingsStore.get().enabled).toBe(true);
    expect(VoiceSettingsStore.get().volume).toBe(DEFAULT_VOICE_SETTINGS.volume);
    expect(spoken.some((utterance) => utterance.text.trim().length > 0)).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHATTINESS_GUESS_LIMIT,
  DEFAULT_VOICE_SETTINGS,
  VOICE_PITCH_RANGE,
  VOICE_RATE_RANGE,
  VOICE_VOLUME_RANGE,
  VoiceSettingsStore,
  areVoiceSettingsEqual,
  clampToRange,
  normalizeVoiceSettings,
} from "@/lib/audio/voice-settings";

beforeEach(() => {
  window.localStorage.clear();
  VoiceSettingsStore.__resetForTests();
});

describe("clampToRange", () => {
  it("keeps values inside the slider bounds", () => {
    expect(clampToRange(9, VOICE_RATE_RANGE)).toBe(VOICE_RATE_RANGE.max);
    expect(clampToRange(-4, VOICE_VOLUME_RANGE)).toBe(VOICE_VOLUME_RANGE.min);
    expect(clampToRange(1.2, VOICE_PITCH_RANGE)).toBe(1.2);
  });

  it("falls back to the minimum for non-numbers", () => {
    expect(clampToRange(Number.NaN, VOICE_RATE_RANGE)).toBe(VOICE_RATE_RANGE.min);
  });
});

describe("normalizeVoiceSettings", () => {
  it("clamps out-of-range values from stale storage", () => {
    const settings = normalizeVoiceSettings({ rate: 12, pitch: -3, volume: 4 });

    expect(settings.rate).toBe(VOICE_RATE_RANGE.max);
    expect(settings.pitch).toBe(VOICE_PITCH_RANGE.min);
    expect(settings.volume).toBe(VOICE_VOLUME_RANGE.max);
  });

  it("drops unknown fields and bad types, keeping the defaults", () => {
    const settings = normalizeVoiceSettings({
      enabled: "yes",
      chattiness: "screaming",
      voiceURI: 42,
      extra: true,
    });

    expect(settings).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("treats an explicit null voiceURI as 'auto' rather than 'unchanged'", () => {
    const picked = normalizeVoiceSettings({ voiceURI: "urn:voice:test" });

    expect(normalizeVoiceSettings({ voiceURI: null }, picked).voiceURI).toBeNull();
    expect(normalizeVoiceSettings({ voiceURI: 42 }, picked).voiceURI).toBe("urn:voice:test");
  });

  it("returns the base settings for junk input", () => {
    expect(normalizeVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(normalizeVoiceSettings("nope")).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("accepts every valid chattiness level", () => {
    for (const chattiness of ["quiet", "normal", "chatty"] as const) {
      expect(normalizeVoiceSettings({ chattiness }).chattiness).toBe(chattiness);
    }
  });
});

describe("VoiceSettingsStore", () => {
  it("applies a patch and persists it", () => {
    VoiceSettingsStore.set({ rate: 1.5, chattiness: "chatty" });

    expect(VoiceSettingsStore.get().rate).toBe(1.5);
    expect(VoiceSettingsStore.get().chattiness).toBe("chatty");
    expect(JSON.parse(window.localStorage.getItem(VoiceSettingsStore.STORAGE_KEY) ?? "{}")).toMatchObject({
      rate: 1.5,
      chattiness: "chatty",
    });
  });

  it("clamps patched values instead of storing them raw", () => {
    VoiceSettingsStore.set({ rate: 99 });

    expect(VoiceSettingsStore.get().rate).toBe(VOICE_RATE_RANGE.max);
  });

  it("keeps the same object reference when nothing changed", () => {
    const before = VoiceSettingsStore.get();
    VoiceSettingsStore.set({ rate: before.rate });

    expect(VoiceSettingsStore.get()).toBe(before);
  });

  it("notifies subscribers only on real changes", () => {
    const listener = vi.fn();
    const unsubscribe = VoiceSettingsStore.subscribe(listener);

    VoiceSettingsStore.set({ volume: 0.25 });
    VoiceSettingsStore.set({ volume: 0.25 });

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    VoiceSettingsStore.set({ volume: 0.5 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("can go back to the auto voice after picking one", () => {
    VoiceSettingsStore.set({ voiceURI: "urn:voice:test" });
    VoiceSettingsStore.set({ voiceURI: null });

    expect(VoiceSettingsStore.get().voiceURI).toBeNull();
  });

  it("toggles and resets", () => {
    expect(VoiceSettingsStore.toggleEnabled()).toBe(!DEFAULT_VOICE_SETTINGS.enabled);

    VoiceSettingsStore.set({ pitch: 0.6, voiceURI: "urn:voice:test" });
    VoiceSettingsStore.reset();

    expect(VoiceSettingsStore.get()).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("survives a localStorage that throws", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(() => VoiceSettingsStore.set({ rate: 1.4 })).not.toThrow();
    expect(VoiceSettingsStore.get().rate).toBe(1.4);

    setItem.mockRestore();
  });
});

describe("areVoiceSettingsEqual", () => {
  it("compares every field", () => {
    expect(areVoiceSettingsEqual(DEFAULT_VOICE_SETTINGS, { ...DEFAULT_VOICE_SETTINGS })).toBe(true);
    expect(areVoiceSettingsEqual(DEFAULT_VOICE_SETTINGS, { ...DEFAULT_VOICE_SETTINGS, pitch: 0.7 })).toBe(false);
  });
});

describe("CHATTINESS_GUESS_LIMIT", () => {
  it("narrates more guesses as chattiness rises", () => {
    expect(CHATTINESS_GUESS_LIMIT.quiet).toBeLessThan(CHATTINESS_GUESS_LIMIT.normal);
    expect(CHATTINESS_GUESS_LIMIT.normal).toBeLessThan(CHATTINESS_GUESS_LIMIT.chatty);
  });
});

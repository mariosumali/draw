/**
 * Adjustable settings for the Quick Draw style guessing voice.
 *
 * Kept separate from {@link SoundEngine} so the narrator can be tuned (or
 * silenced) without touching the game's sound effects, and so the pure
 * normalize/clamp helpers stay testable without a browser.
 */

export type VoiceChattiness = "quiet" | "normal" | "chatty";

export type VoiceSettings = {
  /** Master switch for the narrator. */
  enabled: boolean;
  /** `SpeechSynthesisVoice.voiceURI`, or null to auto-pick the best match. */
  voiceURI: string | null;
  /** Speaking rate passed to `SpeechSynthesisUtterance.rate`. */
  rate: number;
  /** Base pitch passed to `SpeechSynthesisUtterance.pitch`. */
  pitch: number;
  /** Base volume passed to `SpeechSynthesisUtterance.volume`. */
  volume: number;
  /** How many of the AI's guesses get said out loud. */
  chattiness: VoiceChattiness;
};

export type VoiceSettingsPatch = Partial<VoiceSettings>;

export type VoiceRange = {
  min: number;
  max: number;
  step: number;
};

const STORAGE_KEY = "draw-battle:voice-settings";

export const VOICE_RATE_RANGE: VoiceRange = { min: 0.5, max: 2, step: 0.05 };
export const VOICE_PITCH_RANGE: VoiceRange = { min: 0.5, max: 2, step: 0.05 };
export const VOICE_VOLUME_RANGE: VoiceRange = { min: 0, max: 1, step: 0.05 };

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: true,
  voiceURI: null,
  rate: 1.1,
  pitch: 1.15,
  volume: 0.9,
  chattiness: "normal",
};

export const VOICE_CHATTINESS_OPTIONS: { value: VoiceChattiness; label: string; hint: string }[] = [
  { value: "quiet", label: "Quiet", hint: "Only the top guess and the win." },
  { value: "normal", label: "Normal", hint: "Thinks out loud, names its best two guesses." },
  { value: "chatty", label: "Chatty", hint: "Narrates every guess, just like Quick Draw." },
];

/** How many revealed guesses get narrated per round of thinking. */
export const CHATTINESS_GUESS_LIMIT: Record<VoiceChattiness, number> = {
  quiet: 1,
  normal: 2,
  chatty: 5,
};

export function clampToRange(value: number, range: VoiceRange) {
  if (!Number.isFinite(value)) {
    return range.min;
  }

  return Math.min(range.max, Math.max(range.min, value));
}

function isChattiness(value: unknown): value is VoiceChattiness {
  return value === "quiet" || value === "normal" || value === "chatty";
}

/** Coerces anything (stale localStorage, a hand-edited patch) into valid settings. */
export function normalizeVoiceSettings(
  value: unknown,
  base: VoiceSettings = DEFAULT_VOICE_SETTINGS,
): VoiceSettings {
  if (!value || typeof value !== "object") {
    return { ...base };
  }

  const raw = value as Record<string, unknown>;

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    // An explicit null is meaningful: it means "auto-pick the best voice".
    voiceURI:
      raw.voiceURI === null
        ? null
        : typeof raw.voiceURI === "string" && raw.voiceURI
          ? raw.voiceURI
          : base.voiceURI,
    rate: typeof raw.rate === "number" ? clampToRange(raw.rate, VOICE_RATE_RANGE) : base.rate,
    pitch: typeof raw.pitch === "number" ? clampToRange(raw.pitch, VOICE_PITCH_RANGE) : base.pitch,
    volume: typeof raw.volume === "number" ? clampToRange(raw.volume, VOICE_VOLUME_RANGE) : base.volume,
    chattiness: isChattiness(raw.chattiness) ? raw.chattiness : base.chattiness,
  };
}

export function areVoiceSettingsEqual(a: VoiceSettings, b: VoiceSettings) {
  return (
    a.enabled === b.enabled &&
    a.voiceURI === b.voiceURI &&
    a.rate === b.rate &&
    a.pitch === b.pitch &&
    a.volume === b.volume &&
    a.chattiness === b.chattiness
  );
}

function readStoredSettings(): VoiceSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_VOICE_SETTINGS };
    }

    return normalizeVoiceSettings(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

let settings: VoiceSettings = readStoredSettings();
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing / quota — the in-memory settings still apply.
  }
}

function emitChange() {
  listeners.forEach((listener) => {
    listener();
  });
}

export const VoiceSettingsStore = {
  STORAGE_KEY,

  /** Stable reference so `useSyncExternalStore` does not re-render forever. */
  get(): VoiceSettings {
    return settings;
  },

  set(patch: VoiceSettingsPatch) {
    const next = normalizeVoiceSettings({ ...settings, ...patch }, settings);
    if (areVoiceSettingsEqual(next, settings)) {
      return settings;
    }

    settings = next;
    persist();
    emitChange();
    return settings;
  },

  toggleEnabled() {
    VoiceSettingsStore.set({ enabled: !settings.enabled });
    return settings.enabled;
  },

  reset() {
    if (areVoiceSettingsEqual(settings, DEFAULT_VOICE_SETTINGS)) {
      return settings;
    }

    settings = { ...DEFAULT_VOICE_SETTINGS };
    persist();
    emitChange();
    return settings;
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Test-only escape hatch: restore the defaults. Subscribers are deliberately
   * kept — module-level wiring (e.g. the narrator) subscribes once on import.
   */
  __resetForTests() {
    settings = { ...DEFAULT_VOICE_SETTINGS };
  },
};

/**
 * Web Speech wrapper for the guessing narrator.
 *
 * Keeps a tiny priority queue so the voice behaves like Quick, Draw!'s: filler
 * thinking noises are droppable, follow-up guesses cut in over them, and the
 * "Oh, I know!" payoff interrupts whatever is mid-sentence.
 *
 * It also papers over the engines' quirks — Chrome drops an utterance queued
 * in the same task as `cancel()`, can wedge itself paused, and garbage-collects
 * utterances nobody references; Safari and iOS refuse to speak until a user
 * gesture has unlocked the voice — and reports why nothing can be heard so the
 * settings panel never just says "On" over a silent speaker.
 */

import { estimateSpeechDurationMs, type NarrationLine } from "./narration";
import { SoundEngine } from "./sound-engine";
import {
  VoiceSettingsStore,
  clampToRange,
  VOICE_PITCH_RANGE,
  VOICE_RATE_RANGE,
} from "./voice-settings";

export type VoiceOption = {
  voiceURI: string;
  name: string;
  lang: string;
  isDefault: boolean;
  /** Remote voices can disappear or fail when the device is offline. */
  isLocal: boolean;
};

export type SpeakOptions = {
  /** Skip the line if the same `dedupeKey` was spoken within this window. */
  dedupeMs?: number;
  /** Who is talking, for the transcript (e.g. which model produced the guess). */
  source?: string;
};

export type SpokenLine = {
  id: number;
  text: string;
  kind: NarrationLine["kind"];
  source?: string;
};

/** What is keeping the narrator from being heard right now. */
export type VoiceBlocker = "unsupported" | "disabled" | "muted" | "silent";

export type VoiceError = {
  /** `SpeechSynthesisErrorEvent.error`, e.g. "not-allowed" or "synthesis-failed". */
  code: string;
  /** The line that failed; empty for the silent priming utterance. */
  text: string;
};

export type VoiceStatus = "ready" | "off" | "muted" | "unsupported" | "no-voices" | "blocked" | "failed";

/** Transcript depth — enough to read back a round of guessing. */
const HISTORY_LIMIT = 16;

/** Voices that land closest to Quick, Draw!'s bright US narrator, best first. */
const PREFERRED_VOICE_NAMES = [
  "Google US English",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Samantha",
  "Microsoft Zira - English (United States)",
  "Karen",
  "Alex",
];

const MAX_QUEUE_LENGTH = 2;
const PRIORITY_WEIGHT = { low: 0, normal: 1, high: 2 } as const;

/**
 * Chrome and Safari drop an utterance handed to `speak()` in the same task as
 * a `cancel()` that was still tearing down the previous one.
 */
const CANCEL_SETTLE_MS = 60;

/** Only retry failures that can plausibly be fixed by choosing another voice. */
const RECOVERABLE_VOICE_ERRORS = new Set([
  "network",
  "synthesis-unavailable",
  "synthesis-failed",
  "language-unavailable",
  "voice-unavailable",
]);

/** One selected voice plus one dependable fallback; never loop through the list. */
const MAX_VOICE_ATTEMPTS = 2;

/** Error codes that mean "we cut it off on purpose", not a broken engine. */
const EXPECTED_ERRORS = new Set(["interrupted", "canceled"]);

/**
 * Events that count as a user gesture everywhere. `pointerdown` does not for
 * touch input (only `pointerup`/`touchend` do), so a canvas that primes on
 * pointerdown never unlocks an iPad.
 */
const UNLOCK_GESTURES = ["pointerup", "keydown", "touchend"] as const;

/** A line plus who asked for it; the pairing has to survive the queue. */
type PendingLine = {
  line: NarrationLine;
  source?: string;
};

type ActiveSpeech = PendingLine & {
  /** Set once the engine has the line; null while a cancel settles first. */
  utterance: SpeechSynthesisUtterance | null;
  attemptedVoices: Set<SpeechSynthesisVoice>;
  attemptCount: number;
  historyRecorded: boolean;
  startTimer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setTimeout> | null;
};

const NO_HISTORY: SpokenLine[] = [];

let queue: PendingLine[] = [];
let active: ActiveSpeech | null = null;
let cachedVoices: VoiceOption[] = [];
let nativeVoices: SpeechSynthesisVoice[] = [];
let voicesBound = false;
let voicesSettled = false;
let lifecycleBound = false;
let primed = false;
let unbindGestureUnlock: (() => void) | null = null;
let history: SpokenLine[] = NO_HISTORY;
let historySerial = 0;
let lastError: VoiceError | null = null;
let fallbackNotice: string | null = null;
const voiceListeners = new Set<() => void>();
const historyListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
const spokenAt = new Map<string, number>();
/** Chrome never fires `end`/`error` on an utterance that has been collected. */
const retainedUtterances = new Set<SpeechSynthesisUtterance>();

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") {
    return null;
  }

  const synth = window.speechSynthesis;
  return synth && typeof synth.speak === "function" ? synth : null;
}

function createUtterance(text: string): SpeechSynthesisUtterance | null {
  if (typeof window === "undefined" || typeof window.SpeechSynthesisUtterance !== "function") {
    return null;
  }

  return new window.SpeechSynthesisUtterance(text);
}

function isEngineBusy(synth: SpeechSynthesis) {
  return Boolean(synth.speaking || synth.pending);
}

function refreshVoices() {
  const synth = getSynth();
  if (!synth || typeof synth.getVoices !== "function") {
    return;
  }

  const voices = synth.getVoices() ?? [];
  if (voices.length === nativeVoices.length && voices.every((voice, index) => voice === nativeVoices[index])) {
    return;
  }

  nativeVoices = voices;
  cachedVoices = voices.map((voice) => ({
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    isDefault: Boolean(voice.default),
    isLocal: Boolean(voice.localService),
  }));

  voiceListeners.forEach((listener) => {
    listener();
  });
}

function bindVoicesChanged() {
  const synth = getSynth();
  if (voicesBound || !synth) {
    return;
  }

  voicesBound = true;
  refreshVoices();
  const onVoicesChanged = () => {
    voicesSettled = true;
    refreshVoices();
    notifyStatus();
  };
  if (typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", onVoicesChanged);
  } else {
    synth.onvoiceschanged = onVoicesChanged;
  }
}

function bindLifecycle() {
  if (lifecycleBound || typeof document === "undefined") {
    return;
  }

  lifecycleBound = true;
  // Chrome keeps utterances queued (and replays them) when a tab goes to the
  // background, so drop everything pending instead.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      VoiceNarrator.cancel();
    }
  });
  window.addEventListener("pagehide", () => {
    VoiceNarrator.cancel();
  });
}

function bindGestureUnlock() {
  if (unbindGestureUnlock || primed || typeof document === "undefined" || !getSynth()) {
    return;
  }

  const onGesture = () => {
    VoiceNarrator.prime();
    if (primed) {
      unbindGestureUnlock?.();
    }
  };

  UNLOCK_GESTURES.forEach((type) => {
    document.addEventListener(type, onGesture, { capture: true, passive: true });
  });
  unbindGestureUnlock = () => {
    unbindGestureUnlock = null;
    UNLOCK_GESTURES.forEach((type) => {
      document.removeEventListener(type, onGesture, true);
    });
  };
}

function findPreferredVoice(candidates: SpeechSynthesisVoice[]) {
  for (const name of PREFERRED_VOICE_NAMES) {
    const preferred = candidates.find((voice) => voice.name === name);
    if (preferred) {
      return preferred;
    }
  }

  return null;
}

function resolveVoice(
  voiceURI: string | null,
  excluded: ReadonlySet<SpeechSynthesisVoice> = new Set(),
): SpeechSynthesisVoice | null {
  bindVoicesChanged();
  if (nativeVoices.length === 0) {
    return null;
  }

  const candidates = nativeVoices.filter((voice) => !excluded.has(voice));

  if (voiceURI) {
    const exact = candidates.find((voice) => voice.voiceURI === voiceURI);
    if (exact) {
      return exact;
    }
  }

  // An installed voice beats a network one: Chrome's remote voices need a
  // round trip to Google and fail without a word when that doesn't come back.
  const localVoices = candidates.filter((voice) => voice.localService);

  return (
    findPreferredVoice(localVoices) ??
    localVoices.find((voice) => voice.lang === "en-US") ??
    localVoices.find((voice) => voice.lang?.startsWith("en")) ??
    findPreferredVoice(candidates) ??
    candidates.find((voice) => voice.lang === "en-US") ??
    candidates.find((voice) => voice.lang?.startsWith("en")) ??
    localVoices.find((voice) => voice.default) ??
    localVoices[0] ??
    candidates.find((voice) => voice.default) ??
    candidates[0] ??
    null
  );
}

function notifyStatus() {
  statusListeners.forEach((listener) => {
    listener();
  });
}

function recordError(code: string, text: string) {
  lastError = { code, text };
  if (code === "not-allowed") {
    // The browser wants a user gesture first; let the next one retry priming.
    primed = false;
    bindGestureUnlock();
  }

  notifyStatus();
}

function clearError() {
  if (!lastError) {
    return;
  }

  lastError = null;
  notifyStatus();
}

function clearFallbackNotice() {
  if (!fallbackNotice) {
    return;
  }

  fallbackNotice = null;
  notifyStatus();
}

/** Pulls `SpeechSynthesisErrorEvent.error` out of whatever the engine sent. */
function errorCodeOf(event: SpeechSynthesisErrorEvent | undefined): string | null {
  const code = event?.error;
  if (typeof code !== "string" || EXPECTED_ERRORS.has(code)) {
    return null;
  }

  return code;
}

function clearTimers() {
  if (!active) {
    return;
  }

  if (active.watchdog) {
    clearTimeout(active.watchdog);
    active.watchdog = null;
  }

  if (active.startTimer) {
    clearTimeout(active.startTimer);
    active.startTimer = null;
  }
}

function finishActive() {
  clearTimers();
  active = null;
  const next = queue.shift();
  if (next) {
    startSpeaking(next);
  }
}

function retryWithFallback(
  speech: ActiveSpeech,
  utterance: SpeechSynthesisUtterance,
  code: string,
) {
  const fallback = resolveVoice(null, speech.attemptedVoices);
  if (
    active !== speech ||
    speech.attemptCount >= MAX_VOICE_ATTEMPTS ||
    !RECOVERABLE_VOICE_ERRORS.has(code) ||
    !fallback
  ) {
    return false;
  }

  const failedName = utterance.voice?.name ?? "The selected voice";
  fallbackNotice = `${failedName} could not play. Using ${fallback.name} instead.`;
  notifyStatus();

  // Some engines emit `end` after `error`. Retire the old callbacks so that a
  // stale event cannot finish the replacement utterance before it has played.
  utterance.onstart = null;
  utterance.onend = null;
  utterance.onerror = null;
  retainedUtterances.delete(utterance);
  clearTimers();
  speech.utterance = null;
  speech.startTimer = setTimeout(() => {
    speech.startTimer = null;
    if (active === speech) {
      utter(speech);
    }
  }, CANCEL_SETTLE_MS);
  return true;
}

/** Hands the active line to the engine. */
function utter(speech: ActiveSpeech) {
  const { line } = speech;
  const synth = getSynth();
  const utterance = createUtterance(line.text);
  if (!synth || !utterance) {
    active = null;
    return;
  }

  const settings = VoiceSettingsStore.get();
  const rate = clampToRange(settings.rate * line.rateScale, VOICE_RATE_RANGE);
  const pitch = clampToRange(settings.pitch * line.pitchScale, VOICE_PITCH_RANGE);

  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = settings.volume;

  const voice = resolveVoice(settings.voiceURI, speech.attemptedVoices);
  if (voice) {
    speech.attemptedVoices.add(voice);
    utterance.voice = voice;
    if (voice.lang) {
      utterance.lang = voice.lang;
    }
  }
  speech.attemptCount += 1;

  speech.utterance = utterance;
  if (!speech.historyRecorded) {
    speech.historyRecorded = true;
    spokenAt.set(line.dedupeKey, Date.now());
    recordSpoken(speech);
  }

  const settle = () => {
    retainedUtterances.delete(utterance);
    if (active === speech) {
      finishActive();
    }
  };

  utterance.onstart = () => {
    clearError();
    if (speech.attemptCount === 1) {
      clearFallbackNotice();
    }
  };
  utterance.onend = settle;
  utterance.onerror = (event) => {
    const code = errorCodeOf(event);
    if (code && retryWithFallback(speech, utterance, code)) {
      return;
    }

    if (code) {
      recordError(code, line.text);
    }

    settle();
  };
  // Some engines silently drop `onend`; keep the queue moving regardless.
  speech.watchdog = setTimeout(settle, estimateSpeechDurationMs(line.text, rate) * 2 + 1_500);

  // Chrome can wedge itself paused after a cancel, and then queues forever.
  if (synth.paused && typeof synth.resume === "function") {
    synth.resume();
  }

  retainedUtterances.add(utterance);
  synth.speak(utterance);
}

function startSpeaking(pending: PendingLine, delayMs = 0) {
  const speech: ActiveSpeech = {
    ...pending,
    utterance: null,
    attemptedVoices: new Set(),
    attemptCount: 0,
    historyRecorded: false,
    startTimer: null,
    watchdog: null,
  };
  active = speech;

  if (delayMs <= 0) {
    utter(speech);
    return;
  }

  speech.startTimer = setTimeout(() => {
    speech.startTimer = null;
    if (active === speech) {
      utter(speech);
    }
  }, delayMs);
}

/** Cuts off whatever is playing and says `pending` instead. */
function interruptWith(pending: PendingLine) {
  const synth = getSynth();
  const busy = synth ? isEngineBusy(synth) : false;
  const hasNarrationToInterrupt = Boolean(active || queue.length > 0);

  // `cancel(); speak()` in the same task is a common source of swallowed
  // previews. If only the silent unlock utterance is still finishing, queue
  // behind it synchronously so this call remains inside the user's gesture.
  if (hasNarrationToInterrupt) {
    VoiceNarrator.cancel();
  }

  startSpeaking(pending, hasNarrationToInterrupt && busy ? CANCEL_SETTLE_MS : 0);
}

function recordSpoken({ line, source }: PendingLine) {
  historySerial += 1;
  const entry: SpokenLine = {
    id: historySerial,
    text: line.text,
    kind: line.kind,
    source,
  };

  history = [...history, entry].slice(-HISTORY_LIMIT);
  historyListeners.forEach((listener) => {
    listener();
  });
}

function computeBlocker(supported: boolean): VoiceBlocker | null {
  if (!supported) {
    return "unsupported";
  }

  const settings = VoiceSettingsStore.get();
  if (!settings.enabled) {
    return "disabled";
  }

  if (SoundEngine.isMuted()) {
    return "muted";
  }

  if (settings.volume <= 0) {
    return "silent";
  }

  return null;
}

function canSpeak() {
  return Boolean(getSynth()) && VoiceSettingsStore.get().enabled && !SoundEngine.isMuted();
}

export const VoiceNarrator = {
  isSupported() {
    return Boolean(getSynth());
  },

  /** Snapshot of installed voices; stable between `voiceschanged` events. */
  getVoices(): VoiceOption[] {
    bindVoicesChanged();
    return cachedVoices;
  },

  subscribeVoices(listener: () => void) {
    bindVoicesChanged();
    voiceListeners.add(listener);
    return () => {
      voiceListeners.delete(listener);
    };
  },

  /** Recently spoken lines, oldest first. Stable between changes. */
  getHistory(): SpokenLine[] {
    return history;
  },

  subscribeHistory(listener: () => void) {
    historyListeners.add(listener);
    return () => {
      historyListeners.delete(listener);
    };
  },

  clearHistory() {
    if (history.length === 0) {
      return;
    }

    history = NO_HISTORY;
    historyListeners.forEach((listener) => {
      listener();
    });
  },

  /**
   * Why the narrator can or cannot be heard right now. Stable between changes
   * so it is safe to feed `useSyncExternalStore`.
   */
  getStatus(): VoiceStatus {
    const supported = Boolean(getSynth());
    const blocker = computeBlocker(supported);
    let next: VoiceStatus = "ready";

    if (blocker === "unsupported") next = "unsupported";
    else if (blocker === "disabled" || blocker === "silent") next = "off";
    else if (blocker === "muted") next = "muted";
    else if (lastError?.code === "not-allowed") next = "blocked";
    else if (lastError) next = "failed";
    else if (voicesSettled && cachedVoices.length === 0) next = "no-voices";

    return next;
  },

  getLastError() {
    return lastError?.code ?? null;
  },

  getFallbackNotice() {
    return fallbackNotice;
  },

  subscribeStatus(listener: () => void) {
    statusListeners.add(listener);
    return () => {
      statusListeners.delete(listener);
    };
  },

  /** Name of the voice actually in use, for the settings panel's "Auto" label. */
  getResolvedVoiceName(voiceURI: string | null) {
    return resolveVoice(voiceURI)?.name ?? null;
  },

  /**
   * Safari and iOS only allow speech that descends from a user gesture; call
   * this from the first pointer/click handler so later guesses are audible.
   */
  prime() {
    const synth = getSynth();
    if (primed || !synth) {
      return;
    }

    primed = true;
    clearError();
    bindVoicesChanged();
    bindLifecycle();

    const utterance = createUtterance(" ");
    if (!utterance) {
      return;
    }

    utterance.volume = 0;
    utterance.onend = () => {
      retainedUtterances.delete(utterance);
    };
    utterance.onerror = (event) => {
      retainedUtterances.delete(utterance);
      const code = errorCodeOf(event);
      if (code) {
        recordError(code, "");
      }
    };

    retainedUtterances.add(utterance);
    synth.speak(utterance);
  },

  /**
   * Primes on the next tap, key press, or touch anywhere on the page, so the
   * voice is unlocked by whatever the player does first.
   */
  unlockOnGesture() {
    bindGestureUnlock();
  },

  speak(line: NarrationLine, { dedupeMs = 0, source }: SpeakOptions = {}) {
    if (!canSpeak()) {
      return false;
    }

    const pending: PendingLine = { line, source };

    if (dedupeMs > 0) {
      const lastSpokenAt = spokenAt.get(line.dedupeKey);
      if (lastSpokenAt !== undefined && Date.now() - lastSpokenAt < dedupeMs) {
        return false;
      }
    }

    bindLifecycle();

    if (line.priority === "high") {
      interruptWith(pending);
      return true;
    }

    if (!active) {
      startSpeaking(pending);
      return true;
    }

    // A real guess should not wait behind a filler "Hmm...".
    if (PRIORITY_WEIGHT[line.priority] > PRIORITY_WEIGHT[active.line.priority]) {
      interruptWith(pending);
      return true;
    }

    if (line.priority === "low") {
      return false;
    }

    queue.push(pending);
    if (queue.length > MAX_QUEUE_LENGTH) {
      queue = queue.slice(queue.length - MAX_QUEUE_LENGTH);
    }

    return true;
  },

  /** True when speech is allowed right now (supported, enabled, unmuted). */
  canSpeak,

  /**
   * Says an entire pre-built script in order, ignoring the live queue cap:
   * scripted playback is a deliberate "say all of this" request, not a stream
   * of guesses where only the freshest matter.
   */
  speakScript(lines: NarrationLine[], { source }: SpeakOptions = {}) {
    if (!canSpeak() || lines.length === 0) {
      return false;
    }

    const [first, ...rest] = lines;
    interruptWith({ line: first, source });
    queue = rest.map((line) => ({ line, source }));
    return true;
  },

  /**
   * Forgets what was recently said, so repeat-suppression does not carry over
   * from the previous sketch into a brand new one.
   */
  resetDedupe() {
    spokenAt.clear();
  },

  /**
   * Drops pending chatter but lets an in-flight payoff line ("Oh, I know!")
   * finish — used when the prompt rolls over to the next word.
   */
  cancelChatter() {
    queue = [];
    if (active && active.line.priority !== "high") {
      VoiceNarrator.cancel();
    }
  },

  cancel() {
    clearTimers();
    active = null;
    queue = [];
    const synth = getSynth();
    if (synth && typeof synth.cancel === "function") {
      synth.cancel();
    }
    retainedUtterances.clear();
  },

  /** Test-only escape hatch. */
  __resetForTests() {
    VoiceNarrator.cancel();
    unbindGestureUnlock?.();
    cachedVoices = [];
    nativeVoices = [];
    voicesBound = false;
    voicesSettled = false;
    lifecycleBound = false;
    primed = false;
    lastError = null;
    fallbackNotice = null;
    voiceListeners.clear();
    historyListeners.clear();
    statusListeners.clear();
    retainedUtterances.clear();
    spokenAt.clear();
    history = NO_HISTORY;
    historySerial = 0;
  },
};

// Muting the game should silence the narrator mid-sentence, not after it.
if (typeof window !== "undefined") {
  SoundEngine.subscribe(() => {
    if (SoundEngine.isMuted()) {
      VoiceNarrator.cancel();
    }

    notifyStatus();
  });
  VoiceSettingsStore.subscribe(() => {
    clearFallbackNotice();
    if (!VoiceSettingsStore.get().enabled) {
      VoiceNarrator.cancel();
    }

    notifyStatus();
  });
}

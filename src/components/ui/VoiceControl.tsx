"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { buildNarrationLine } from "@/lib/audio/narration";
import { SoundEngine } from "@/lib/audio/sound-engine";
import { VoiceNarrator, type VoiceOption, type VoiceStatus } from "@/lib/audio/voice";
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_CHATTINESS_OPTIONS,
  VOICE_PITCH_RANGE,
  VOICE_RATE_RANGE,
  VOICE_VOLUME_RANGE,
  VoiceSettingsStore,
  type VoiceRange,
} from "@/lib/audio/voice-settings";

const NO_VOICES: VoiceOption[] = [];
const TEST_LABELS = ["pelican", "octopus", "hot air balloon", "cactus", "unicycle"];
const PANEL_WIDTH = 300;
const PANEL_GAP = 10;
const VIEWPORT_MARGIN = 12;

type PanelPosition = { top: number; left: number };

const VOICE_STATUS_HINT: Record<VoiceStatus, string> = {
  ready: "It thinks out loud while you draw.",
  off: "Switch it on to hear the guesses.",
  muted: "Silent: the game is muted.",
  unsupported: "This browser cannot speak.",
  "no-voices": "No speech voices installed.",
  blocked: "Your browser blocked the speech.",
  failed: "The speech engine could not play it.",
};

const VOICE_STATUS_DETAIL: Record<VoiceStatus, string> = {
  ready: "",
  off: "",
  muted: "The speaker toggle mutes every sound, the narrator included.",
  unsupported: "This browser has no Web Speech API, so nothing can be spoken.",
  "no-voices":
    "The browser supports speech but the system has no voices installed. On Linux, install speech-dispatcher and a voice such as espeak-ng.",
  blocked: "Browsers only allow speech after you interact with the page. Draw a stroke, or press “Hear it”.",
  failed:
    "The system speech engine returned an error. Try a different voice below, or check your output device and system volume.",
};

type VoiceControlProps = {
  /** Renders the trigger without the "Voice" caption, for tight toolbars. */
  compact?: boolean;
};

export function VoiceControl({ compact = false }: VoiceControlProps) {
  const settings = useSyncExternalStore(
    VoiceSettingsStore.subscribe,
    VoiceSettingsStore.get,
    () => DEFAULT_VOICE_SETTINGS,
  );
  const voices = useSyncExternalStore(
    VoiceNarrator.subscribeVoices,
    VoiceNarrator.getVoices,
    () => NO_VOICES,
  );
  const supported = useSyncExternalStore(
    VoiceNarrator.subscribeVoices,
    VoiceNarrator.isSupported,
    () => true,
  );
  const status = useSyncExternalStore(
    VoiceNarrator.subscribeStatus,
    VoiceNarrator.getStatus,
    (): VoiceStatus => "ready",
  );

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>({ top: 0, left: 0 });
  const [testIndex, setTestIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // The panel is portalled to <body>: the game's rotated paper cards create
  // stacking contexts that would otherwise clip it.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const anchor = trigger.getBoundingClientRect();
    const height = panelRef.current?.getBoundingClientRect().height ?? 0;
    const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - PANEL_WIDTH, maxLeft));

    const below = anchor.bottom + PANEL_GAP;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
    const top = fitsBelow
      ? below
      : Math.max(
          VIEWPORT_MARGIN,
          Math.min(anchor.top - height - PANEL_GAP, window.innerHeight - height - VIEWPORT_MARGIN),
        );

    setPosition((current) => (current.top === top && current.left === left ? current : { top, left }));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggleOpen = useCallback(() => {
    VoiceNarrator.prime();
    setOpen((current) => !current);
  }, []);

  const toggleEnabled = useCallback(() => {
    VoiceNarrator.prime();
    VoiceSettingsStore.toggleEnabled();
  }, []);

  const playTestLine = useCallback(() => {
    const label = TEST_LABELS[testIndex % TEST_LABELS.length];
    setTestIndex((current) => current + 1);

    // This is an explicit request to hear audio, so repair every reversible
    // silent state instead of leaving the button looking broken.
    if (SoundEngine.isMuted()) {
      SoundEngine.unmute();
    }

    const current = VoiceSettingsStore.get();
    VoiceSettingsStore.set({
      enabled: true,
      volume: current.volume > 0 ? current.volume : DEFAULT_VOICE_SETTINGS.volume,
    });

    VoiceNarrator.speak(buildNarrationLine({ kind: "recognized", label, seed: `test-${testIndex}` }));
  }, [testIndex]);

  const englishVoices = voices.filter((voice) => voice.lang?.toLowerCase().startsWith("en"));
  const otherVoices = voices.filter((voice) => !voice.lang?.toLowerCase().startsWith("en"));
  const autoVoiceName = supported ? VoiceNarrator.getResolvedVoiceName(null) : null;
  const fallbackNotice = VoiceNarrator.getFallbackNotice();
  const activeChattiness = VOICE_CHATTINESS_OPTIONS.find((option) => option.value === settings.chattiness);

  const panel = (
    <div
      aria-label="Guess voice settings"
      className="voice-panel"
      id={panelId}
      ref={panelRef}
      role="group"
      style={{ top: position.top, left: position.left }}
    >
      <div className="voice-panel-header">
        <div>
          <strong>Guessing voice</strong>
          <small>{VOICE_STATUS_HINT[status]}</small>
        </div>
        <button
          aria-pressed={settings.enabled}
          className={`voice-switch ${settings.enabled ? "on" : ""}`}
          disabled={!supported}
          onClick={toggleEnabled}
          type="button"
        >
          {settings.enabled ? "On" : "Off"}
        </button>
      </div>

      {status !== "ready" && status !== "off" ? (
        <p className={`voice-alert voice-alert-${status}`} role="status">
          <span>{VOICE_STATUS_DETAIL[status]}</span>
          {status === "muted" ? (
            <button onClick={() => SoundEngine.unmute()} type="button">
              Unmute the game
            </button>
          ) : null}
        </p>
      ) : null}

      {status === "ready" && fallbackNotice ? (
        <p className="voice-alert" role="status">
          <span>{fallbackNotice}</span>
          <span>Some voices need a network connection or a downloaded system voice.</span>
        </p>
      ) : null}

      <label className="voice-field">
        <span>Voice</span>
        <select
          disabled={!supported}
          onChange={(event) => VoiceSettingsStore.set({ voiceURI: event.target.value || null })}
          value={settings.voiceURI ?? ""}
        >
          <option value="">Auto{autoVoiceName ? ` (${autoVoiceName})` : ""}</option>
          {englishVoices.length ? (
            <optgroup label="English">
              {englishVoices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang}){voice.isLocal ? "" : " — online"}
                </option>
              ))}
            </optgroup>
          ) : null}
          {otherVoices.length ? (
            <optgroup label="Other languages">
              {otherVoices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang}){voice.isLocal ? "" : " — online"}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>

      <VoiceSlider
        disabled={!supported}
        format={(value) => `${value.toFixed(2)}x`}
        label="Speed"
        onChange={(rate) => VoiceSettingsStore.set({ rate })}
        range={VOICE_RATE_RANGE}
        value={settings.rate}
      />
      <VoiceSlider
        disabled={!supported}
        format={(value) => value.toFixed(2)}
        label="Pitch"
        onChange={(pitch) => VoiceSettingsStore.set({ pitch })}
        range={VOICE_PITCH_RANGE}
        value={settings.pitch}
      />
      <VoiceSlider
        disabled={!supported}
        format={(value) => `${Math.round(value * 100)}%`}
        label="Volume"
        onChange={(volume) => VoiceSettingsStore.set({ volume })}
        range={VOICE_VOLUME_RANGE}
        value={settings.volume}
      />

      <fieldset className="voice-field voice-chattiness">
        <legend>Chattiness</legend>
        <div className="voice-segmented">
          {VOICE_CHATTINESS_OPTIONS.map((option) => (
            <button
              aria-pressed={settings.chattiness === option.value}
              className={settings.chattiness === option.value ? "selected" : ""}
              disabled={!supported}
              key={option.value}
              onClick={() => VoiceSettingsStore.set({ chattiness: option.value })}
              title={option.hint}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <small>{activeChattiness?.hint}</small>
      </fieldset>

      <div className="voice-panel-actions">
        <button className="button secondary" disabled={!supported} onClick={playTestLine} type="button">
          Hear it
        </button>
        <button
          className="button secondary"
          onClick={() => {
            VoiceNarrator.cancel();
            VoiceSettingsStore.reset();
          }}
          type="button"
        >
          Reset
        </button>
      </div>
    </div>
  );

  return (
    <div className="voice-control">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={`Guess voice settings (${status === "ready" ? "on" : status})`}
        className={`voice-trigger ${status === "ready" ? "" : "voice-trigger-off"}`}
        onClick={toggleOpen}
        ref={triggerRef}
        title="Guess voice settings"
        type="button"
      >
        <VoiceIcon muted={status !== "ready"} />
        {compact ? null : <span>Voice</span>}
      </button>

      {open ? createPortal(panel, document.body) : null}
    </div>
  );
}

function VoiceSlider({
  disabled,
  format,
  label,
  onChange,
  range,
  value,
}: {
  disabled: boolean;
  format: (value: number) => string;
  label: string;
  onChange: (value: number) => void;
  range: VoiceRange;
  value: number;
}) {
  return (
    <label className="voice-field voice-slider">
      <span>
        {label}
        <em>{format(value)}</em>
      </span>
      <input
        disabled={disabled}
        max={range.max}
        min={range.min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={range.step}
        type="range"
        value={value}
      />
    </label>
  );
}

function VoiceIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M20.5 11.2c0 4.1-3.8 7.4-8.5 7.4a10 10 0 0 1-2.4-.3L4.4 20.4l1.2-3.6A7 7 0 0 1 3.5 11.2c0-4.1 3.8-7.4 8.5-7.4s8.5 3.3 8.5 7.4Z" />
      {muted ? (
        <>
          <line x1="9" x2="15" y1="8.5" y2="14" />
          <line x1="15" x2="9" y1="8.5" y2="14" />
        </>
      ) : (
        <>
          <line x1="8.6" x2="8.6" y1="9.6" y2="12.8" />
          <line x1="12" x2="12" y1="7.9" y2="14.5" />
          <line x1="15.4" x2="15.4" y1="9.9" y2="12.5" />
        </>
      )}
    </svg>
  );
}

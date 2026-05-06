"use client";

import { useCallback, useState } from "react";

import { SoundEngine } from "@/lib/audio/sound-engine";

export function SoundToggle() {
  const [muted, setMuted] = useState(() => SoundEngine.isMuted());

  const toggle = useCallback(() => {
    const nowMuted = !SoundEngine.toggle();
    setMuted(nowMuted);
  }, []);

  return (
    <button
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
      className="sound-toggle"
      onClick={toggle}
      title={muted ? "Unmute sounds" : "Mute sounds"}
      type="button"
    >
      {muted ? <SpeakerOff /> : <SpeakerOn />}
    </button>
  );
}

function SpeakerOn() {
  return (
    <svg
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
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function SpeakerOff() {
  return (
    <svg
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
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" x2="17" y1="9" y2="15" />
      <line x1="17" x2="23" y1="9" y2="15" />
    </svg>
  );
}

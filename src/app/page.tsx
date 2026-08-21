"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";

import { LandingDemoCanvas } from "@/components/game/LandingDemoCanvas";
import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { VoiceControl } from "@/components/ui/VoiceControl";
import { startLobbyMusic, stopLobbyMusic } from "@/lib/audio/music";
import { MAX_PLAYERS } from "@/lib/game/types";

const landingFeatures = [
  `Up to ${MAX_PLAYERS} players per room`,
  "Three genuinely different scoring modes",
  "Share an invite link in 1 click",
  "AI guesses your sketch in real time",
] as const;

export default function Home() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");

  useEffect(() => {
    startLobbyMusic();
    return () => stopLobbyMusic();
  }, []);

  function getRoomPath(roomId: string) {
    const params = new URLSearchParams();
    if (playerName.trim()) {
      params.set("name", playerName.trim());
    }
    return `/room/${encodeURIComponent(roomId)}${params.size ? `?${params.toString()}` : ""}`;
  }

  function createRoom() {
    router.push(getRoomPath(nanoid(8)));
  }

  function joinRoom() {
    const normalizedRoomCode = roomCode.trim();
    if (!normalizedRoomCode) {
      return;
    }
    router.push(getRoomPath(normalizedRoomCode));
  }

  return (
    <main className="page-shell landing-shell">
      <section aria-label="Draw Battle introduction" className="home-hero">
        <div className="hero-copy-block">
          <p className="eyebrow">
            <DoodleDecoration type="pencil" size={20} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Quick Draw multiplayer
          </p>
          <h1>
            <span>Draw</span>
            <span className="hero-battle-line">
              Battle<span className="hero-bang">!</span>
              <span className="hero-burst" aria-hidden="true" />
            </span>
          </h1>
          <p className="hero-copy">
            Real-time multiplayer drawing rooms. Pick a race, precision, or misdirection challenge, share the
            link, and turn <span className="highlight">live AI guesses</span> into the competition.
          </p>
          <ul className="feature-list">
            {landingFeatures.map((feature) => (
              <li key={feature}>
                <span className="feature-check" aria-hidden="true" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <aside aria-label="Start a room" className="start-card">
          <form
            className="start-form"
            onSubmit={(event) => {
              event.preventDefault();
              createRoom();
            }}
          >
            <div className="start-card-heading">
              <h2>Start a room</h2>
              <p>Takes about 4 seconds.</p>
            </div>
            <label className="name-label" htmlFor="player-name">
              Your name
            </label>
            <input
              id="player-name"
              maxLength={24}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="e.g. Mira"
              value={playerName}
            />
            <button className="button" type="submit">
              <DoodleDecoration type="star" size={20} color="#1a1a1a" style={{ marginRight: 6 }} />
              Create room
            </button>
          </form>
          <details className="join-room">
            <summary>or join with a code</summary>
            <form
              className="join-form"
              onSubmit={(event) => {
                event.preventDefault();
                joinRoom();
              }}
            >
              <label className="sr-only" htmlFor="room-code">
                Room code
              </label>
              <input
                id="room-code"
                maxLength={32}
                onChange={(event) => setRoomCode(event.target.value)}
                placeholder="room-code"
                value={roomCode}
              />
              <button className="button secondary" disabled={!roomCode.trim()} type="submit">
                Join
              </button>
            </form>
          </details>
          <div className="sound-row">
            <span>Sound &amp; music</span>
            <SoundToggle />
          </div>
          <div className="sound-row">
            <span>Guessing voice</span>
            <VoiceControl compact />
          </div>
        </aside>

      </section>

      <section aria-label="Try the recognizer" className="recognizer-card panel">
        <LandingDemoCanvas />
      </section>
    </main>
  );
}

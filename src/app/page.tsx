"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";

import { LandingDemoCanvas } from "@/components/game/LandingDemoCanvas";
import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { VoiceControl } from "@/components/ui/VoiceControl";
import { startLobbyMusic, stopLobbyMusic } from "@/lib/audio/music";
import { GAME_EXPERIENCES } from "@/lib/game/experiences";
import { MAX_PLAYERS } from "@/lib/game/types";

const landingFeatures = [
  `A five-round party show for up to ${MAX_PLAYERS}`,
  "Daily, telephone, puzzle, and sandbox loops",
  "Round reveals turn mistakes into highlights",
  "Live AI guesses and optional voice",
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
            Five ways to play with a drawing AI
          </p>
          <h1>
            <span>Draw</span>
            <span className="hero-battle-line">
              Battle<span className="hero-bang">!</span>
              <span className="hero-burst" aria-hidden="true" />
            </span>
          </h1>
          <p className="hero-copy">
            Race it, fool it, follow its mistakes, or ignore the clock entirely. The AI is the referee and chaotic
            co-host; <span className="highlight">your drawings are the show.</span>
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
              <p className="eyebrow">Party Show</p>
              <h2>Start the main event</h2>
              <p>Five shared rounds with a reveal after every prompt.</p>
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
              Create Party Show
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

      <section className="experience-section" aria-labelledby="experience-title">
        <header>
          <div>
            <p className="eyebrow">Or take the AI somewhere stranger</p>
            <h2 id="experience-title">Four more playable directions</h2>
          </div>
          <p>Each mode changes the objective, pace, and payoff—not just the score multiplier.</p>
        </header>
        <div className="experience-grid">
          {GAME_EXPERIENCES.filter((experience) => experience.id !== "party").map((experience, index) => (
            <Link href={experience.href} key={experience.id} style={{ "--experience-accent": experience.accent } as CSSProperties}>
              <span className="experience-number">0{index + 2}</span>
              <small>{experience.eyebrow} · {experience.players}</small>
              <strong>{experience.name}</strong>
              <p>{experience.tagline}</p>
              <em>{experience.description}</em>
              <b>Play now →</b>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Try the recognizer" className="recognizer-card panel">
        <LandingDemoCanvas />
      </section>
    </main>
  );
}

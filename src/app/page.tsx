"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";

export default function Home() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");

  function createRoom() {
    const roomId = nanoid(8);
    const params = new URLSearchParams();
    if (playerName.trim()) {
      params.set("name", playerName.trim());
    }
    router.push(`/room/${roomId}${params.size ? `?${params.toString()}` : ""}`);
  }

  return (
    <main className="page-shell">
      <section className="home-hero panel">
        <div>
          <p className="eyebrow">
            <DoodleDecoration type="pencil" size={20} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Quick Draw multiplayer
          </p>
          <h1>Draw fast. Get recognized. Beat the clock.</h1>
          <p className="hero-copy">
            Invite a friend into a shared room and race through AI-recognized doodle prompts
            before the 90-second timer runs out.
          </p>
          <DoodleDecoration
            type="squiggle"
            size={80}
            color="#e88e8e"
            style={{ marginTop: 16, display: "block" }}
          />
        </div>

        <div className="start-card">
          <label htmlFor="player-name">
            <DoodleDecoration type="arrow" size={22} color="#1a1a1a" rotate={-10} style={{ marginRight: 4, verticalAlign: "middle" }} />
            Your name
          </label>
          <input
            id="player-name"
            maxLength={24}
            onChange={(event) => setPlayerName(event.target.value)}
            placeholder="Picasso Jr."
            value={playerName}
          />
          <button className="button" onClick={createRoom} type="button">
            <DoodleDecoration type="star" size={20} color="#1a1a1a" style={{ marginRight: 6 }} />
            Start doodling!
          </button>
          <p className="muted">Share the room link with a friend. First to sketch more wins!</p>
        </div>
      </section>
    </main>
  );
}

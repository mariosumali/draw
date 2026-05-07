"use client";

import { useEffect, useState } from "react";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import type { GameState, PlayerState } from "@/lib/game/types";

type GameHudProps = {
  receivedAt: number;
  state: GameState;
  localPlayer: PlayerState | undefined;
};

export function GameHud({ receivedAt, state, localPlayer }: GameHudProps) {
  const serverNow = useSyncedServerNow(state, receivedAt);
  const remainingMs =
    state.phase === "playing" && state.endsAt
      ? Math.max(0, state.endsAt - serverNow)
      : state.roundDurationMs;
  const countdownMs =
    state.phase === "countdown" && state.countdownStartedAt
      ? Math.max(0, state.countdownStartedAt + 3_000 - serverNow)
      : 0;

  return (
    <section className="hud">
      <div>
        <span className="hud-label">Phase</span>
        <strong>{formatPhase(state.phase)}</strong>
      </div>
      <div>
        <span className="hud-label">
          Time
        </span>
        <strong>{state.phase === "countdown" ? Math.ceil(countdownMs / 1000) : formatTime(remainingMs)}</strong>
      </div>
      <div>
        <span className="hud-label">Your score</span>
        <strong>
          {localPlayer?.score ?? 0}
          {(localPlayer?.score ?? 0) > 0 && (
            <DoodleDecoration type="star" size={18} color="#2e7d32" style={{ marginLeft: 6, verticalAlign: "middle" }} />
          )}
        </strong>
      </div>
      <div>
        <span className="hud-label">Players</span>
        <strong>{state.players.filter((player) => player.connected).length}/{state.maxPlayers}</strong>
      </div>
    </section>
  );
}

function useSyncedServerNow(state: GameState, receivedAt: number) {
  const [clientNow, setClientNow] = useState(() => Date.now());

  useEffect(() => {
    if (state.phase !== "countdown" && state.phase !== "playing") {
      return;
    }

    const timer = window.setInterval(() => {
      setClientNow(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [state.phase]);

  return state.serverNow + Math.max(0, clientNow - receivedAt);
}

function formatPhase(phase: GameState["phase"]) {
  if (phase === "countdown") {
    return "Get ready";
  }

  return phase[0].toUpperCase() + phase.slice(1);
}

function formatTime(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

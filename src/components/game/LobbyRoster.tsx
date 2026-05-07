"use client";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import type { PlayerState } from "@/lib/game/types";

type LobbyRosterProps = {
  players: PlayerState[];
  maxPlayers: number;
  localPlayerId?: string | null;
  compact?: boolean;
};

export function LobbyRoster({ players, maxPlayers, localPlayerId, compact = false }: LobbyRosterProps) {
  const connectedPlayers = players.filter((player) => player.connected);
  const readyPlayers = connectedPlayers.filter((player) => player.ready);
  const waitingSeats = Math.max(0, maxPlayers - connectedPlayers.length);

  return (
    <section className={`side-card panel lobby-roster ${compact ? "compact" : ""}`}>
      <div className="lobby-roster-header">
        <div>
          <p className="eyebrow">
            <DoodleDecoration type="circle" size={18} color="#90caf9" style={{ marginRight: 5, verticalAlign: "middle" }} />
            Lobby
          </p>
          <h2>{connectedPlayers.length} of {maxPlayers}</h2>
        </div>
        <span className="lobby-live-badge">Live</span>
        <span className="lobby-roster-count">
          {connectedPlayers.length}/{maxPlayers}
        </span>
      </div>
      <p className="muted lobby-roster-summary">
        {waitingSeats > 0
          ? `Waiting for ${waitingSeats} more player${waitingSeats === 1 ? "" : "s"}.`
          : `${readyPlayers.length}/${connectedPlayers.length} player${connectedPlayers.length === 1 ? "" : "s"} ready.`}
      </p>
      <ol className="player-slot-list" aria-label="Lobby players">
        {Array.from({ length: maxPlayers }, (_, index) => {
          const player = players.find((candidate) => candidate.slot === index);
          const isLocalPlayer = player?.id === localPlayerId;
          const status = getPlayerLobbyStatus(player);

          return (
            <li className={status.className} key={player?.id ?? `open-${index}`}>
              <span className="player-slot-avatar" aria-hidden="true">
                {player ? getInitials(player.name) : "?"}
              </span>
              <span className="player-slot-meta">
                <strong>
                  {player ? player.name : `Open seat ${index + 1}`}
                  {isLocalPlayer ? <em> you</em> : null}
                </strong>
                <small>seat {index + 1}</small>
              </span>
              <span className="player-status-pill">{status.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function getPlayerLobbyStatus(player?: PlayerState) {
  if (!player) {
    return { className: "waiting", label: "waiting" };
  }

  if (!player.connected) {
    return { className: "away", label: "disconnected" };
  }

  return player.ready
    ? { className: "ready", label: "ready" }
    : { className: "joined", label: "not ready" };
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "PL";
}

"use client";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import type { GameState, PlayerState } from "@/lib/game/types";

type ResultPanelProps = {
  state: GameState;
  localPlayer: PlayerState | undefined;
  onReset: () => void;
};

export function ResultPanel({ state, localPlayer, onReset }: ResultPanelProps) {
  if (state.phase !== "finished") {
    return null;
  }

  const winner = state.players.find((player) => player.id === state.winnerId);
  const isTie = !state.winnerId;
  const localWon = winner && localPlayer?.id === winner.id;

  return (
    <>
      <div className="result-backdrop" />
      <section className="result-panel">
        <p className="eyebrow">
          <DoodleDecoration type="squiggle" size={60} color="#e53935" style={{ display: "block", marginBottom: 4 }} />
          Round over!
        </p>
        <h2>
          {isTie ? "It's a tie!" : localWon ? "You win!" : `${winner?.name ?? "Opponent"} wins!`}
          {localWon && <DoodleDecoration type="star" size={36} color="#ff9800" rotate={15} style={{ marginLeft: 8, verticalAlign: "middle" }} />}
        </h2>
        <div className="scoreboard">
          {state.players.map((player) => (
            <div key={player.id}>
              <span>
                {player.id === state.winnerId && (
                  <DoodleDecoration type="star" size={18} color="#ff9800" style={{ marginRight: 6, verticalAlign: "middle" }} />
                )}
                {player.name}
              </span>
              <strong>{player.score}</strong>
            </div>
          ))}
        </div>
        <button className="button" onClick={onReset} type="button">
          <DoodleDecoration type="pencil" size={20} style={{ marginRight: 6 }} />
          Sketch again!
        </button>
      </section>
    </>
  );
}

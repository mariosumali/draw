"use client";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import type { DrawingSnapshot, GameState, PlayerState } from "@/lib/game/types";

type ResultPanelProps = {
  drawings: DrawingSnapshot[];
  state: GameState;
  localPlayer: PlayerState | undefined;
  onReset: () => void;
};

export function ResultPanel({ drawings, state, localPlayer, onReset }: ResultPanelProps) {
  if (state.phase !== "finished") {
    return null;
  }

  const winner = state.players.find((player) => player.id === state.winnerId);
  const isTie = !state.winnerId;
  const localWon = winner && localPlayer?.id === winner.id;
  const topScore = Math.max(0, ...state.players.map((player) => player.score));
  const sortedPlayers = [...state.players].sort((a, b) => b.score - a.score || a.slot - b.slot);
  const sortedDrawings = [...drawings].sort((a, b) => a.savedAt - b.savedAt);

  return (
    <>
      <div className="result-backdrop" />
      <section className="result-panel">
        <div className="result-hero">
          <p className="eyebrow">
            Round over!
          </p>
          <h2>
            {isTie ? "It's a tie!" : localWon ? "You win!" : `${winner?.name ?? "Opponent"} wins!`}
            {localWon && <DoodleDecoration type="star" size={30} color="#ff9800" rotate={15} style={{ marginLeft: 8, verticalAlign: "middle" }} />}
          </h2>
          <p className="result-summary">
            {isTie
              ? `Everyone landed at ${topScore} point${topScore === 1 ? "" : "s"}.`
              : `${winner?.name ?? "Winner"} finished with ${winner?.score ?? 0} point${winner?.score === 1 ? "" : "s"}.`}
          </p>
        </div>

        <div className="scoreboard" aria-label="Final scores">
          {sortedPlayers.map((player) => (
            <div className={`score-row ${player.id === state.winnerId ? "winner" : ""}`} key={player.id}>
              <span>
                {player.id === state.winnerId && (
                  <DoodleDecoration type="star" size={18} color="#ff9800" style={{ marginRight: 6, verticalAlign: "middle" }} />
                )}
                {player.name}
                {localPlayer?.id === player.id ? <small>You</small> : null}
              </span>
              <strong>{player.score}</strong>
            </div>
          ))}
        </div>

        <section className="drawing-review" aria-labelledby="drawing-review-title">
          <div className="drawing-review-heading">
            <h3 id="drawing-review-title">Your drawings</h3>
            <span>{sortedDrawings.length} saved</span>
          </div>
          {sortedDrawings.length ? (
            <div className="drawing-grid">
              {sortedDrawings.map((drawing) => (
                <DrawingCard drawing={drawing} key={drawing.id} />
              ))}
            </div>
          ) : (
            <p className="muted empty-drawings">
              No drawings saved this round. Finish a prompt or leave a sketch on the canvas before time runs out next round.
            </p>
          )}
        </section>

        <div className="result-actions">
          <button className="button" disabled={!localPlayer} onClick={onReset} type="button">
            <DoodleDecoration type="pencil" size={20} style={{ marginRight: 6 }} />
            Request rematch
          </button>
          {!localPlayer ? <p className="muted">Only active players can request the rematch.</p> : null}
        </div>
      </section>
    </>
  );
}

function DrawingCard({ drawing }: { drawing: DrawingSnapshot }) {
  const confidence = drawing.predictions[0]?.confidence;
  const resultLabel =
    drawing.recognized && typeof confidence === "number"
      ? `Matched at ${Math.round(confidence * 100)}%`
      : "Last sketch";

  return (
    <article className="drawing-card">
      <div
        aria-label={`Drawing of ${drawing.prompt}`}
        className="drawing-card-image"
        role="img"
        style={{ backgroundImage: `url("${drawing.imageDataUrl}")` }}
      />
      <div>
        <strong>{drawing.prompt}</strong>
        <small>{resultLabel}</small>
      </div>
    </article>
  );
}

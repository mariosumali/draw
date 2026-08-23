"use client";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { isMatchingPrediction } from "@/lib/game/guesses";
import { getGameModeDefinition, scorePrompt, type GameMode } from "@/lib/game/modes";
import type { DrawingSnapshot, GameState, PlayerState, RoundSubmission } from "@/lib/game/types";

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
  const matchGallery = state.roundHistory.flatMap((round) =>
    round.submissions.map((submission) => ({ submission, mode: round.mode, roundIndex: round.roundIndex })),
  );

  return (
    <>
      <div className="result-backdrop" />
      <section aria-labelledby="result-title" aria-modal="true" className="result-panel" role="dialog">
        <div className="result-hero">
          <div className="result-trophy" aria-hidden="true">
            <DoodleDecoration color={isTie ? "#5f8fb4" : "#d88700"} size={64} type="trophy" />
          </div>
          <p className="eyebrow">Party Show · {state.roundCount} rounds complete</p>
          <h2 id="result-title">
            {isTie ? "It's a tie!" : localWon ? "You win!" : `${winner?.name ?? "Opponent"} wins!`}
          </h2>
          <p className="result-summary">
            {isTie
              ? `Everyone landed at ${topScore} point${topScore === 1 ? "" : "s"}.`
              : `${winner?.name ?? "Winner"} finished with ${winner?.score ?? 0} point${winner?.score === 1 ? "" : "s"}.`}
          </p>
        </div>

        <div className="scoreboard" aria-label="Final scores">
          {sortedPlayers.map((player, index) => (
            <div className={`score-row ${player.id === state.winnerId ? "winner" : ""}`} key={player.id}>
              <span>
                <b className="score-position">{index + 1}</b>
                <span className="score-player-copy">
                  <strong>{player.name}</strong>
                  <small>
                    {localPlayer?.id === player.id ? "You · " : ""}
                    {player.completedPrompts.length} solved
                  </small>
                </span>
              </span>
              <strong>{player.score} pt{player.score === 1 ? "" : "s"}</strong>
            </div>
          ))}
        </div>

        <section className="drawing-review" aria-labelledby="drawing-review-title">
          <div className="drawing-review-heading">
            <h3 id="drawing-review-title">Match gallery</h3>
            <span>{matchGallery.length || sortedDrawings.length} sketches</span>
          </div>
          {matchGallery.length ? (
            <div className="drawing-grid">
              {matchGallery.map(({ submission, mode: roundMode, roundIndex }) => (
                <SubmissionCard
                  key={`${roundIndex}:${submission.playerId}`}
                  mode={roundMode}
                  roundIndex={roundIndex}
                  submission={submission}
                />
              ))}
            </div>
          ) : sortedDrawings.length ? (
            <div className="drawing-grid">
              {sortedDrawings.map((drawing) => (
                <DrawingCard drawing={drawing} key={drawing.id} mode={state.mode} />
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
            <DoodleDecoration type="lightning" size={20} style={{ marginRight: 6 }} />
            Play again
          </button>
          <p className="muted">
            {localPlayer ? "Returns everyone to the lobby." : "Only active players can start the rematch."}
          </p>
        </div>
      </section>
    </>
  );
}

function SubmissionCard({
  submission,
  mode,
  roundIndex,
}: {
  submission: RoundSubmission;
  mode: GameMode;
  roundIndex: number;
}) {
  const rule = getGameModeDefinition(mode);
  const wrongGuess = submission.predictions.find((prediction) =>
    !isMatchingPrediction(submission.prompt, prediction),
  );

  return (
    <article className="drawing-card">
      <div
        aria-label={`${submission.playerName}'s drawing of ${submission.prompt}`}
        className="drawing-card-image"
        role="img"
        style={submission.imageDataUrl ? { backgroundImage: `url("${submission.imageDataUrl}")` } : undefined}
      />
      <div>
        <strong>{submission.prompt}</strong>
        <small>
          R{roundIndex + 1} · {submission.playerName} · {rule.name} · {submission.recognized ? `+${submission.award}` : "unsolved"}
        </small>
        {wrongGuess ? <small>AI first tried “{wrongGuess.label}”</small> : null}
      </div>
    </article>
  );
}

function DrawingCard({ drawing, mode }: { drawing: DrawingSnapshot; mode: GameMode }) {
  const matchingPrediction = drawing.predictions.find((prediction) =>
    isMatchingPrediction(drawing.prompt, prediction),
  );
  const confidence = matchingPrediction?.confidence;
  const award = scorePrompt(mode, {
    confidence: confidence ?? 0,
    strokeCount: drawing.strokeCount ?? 99,
    misdirected: Boolean(drawing.misdirected),
  });
  const resultLabel =
    drawing.recognized && typeof confidence === "number"
      ? `Solved · +${award} · ${drawing.strokeCount ?? "?"} strokes`
      : "Passed sketch";

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

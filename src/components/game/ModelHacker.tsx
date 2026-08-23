"use client";

import { useEffect, useRef, useState } from "react";

import { ArcadeError, ArcadeGuessRail, ArcadeShell } from "@/components/game/ArcadeShell";
import { DrawCanvas } from "@/components/game/DrawCanvas";
import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { useArcadeRecognizer } from "@/hooks/useArcadeRecognizer";
import { HACKER_CHALLENGES, type HackerChallenge } from "@/lib/game/experiences";
import { isMatchingPrediction } from "@/lib/game/guesses";
import type { DrawingSnapshot } from "@/lib/game/types";

type HackerResult = {
  challenge: HackerChallenge;
  drawing: DrawingSnapshot | null;
  award: number;
};

export function ModelHacker() {
  const recognizer = useArcadeRecognizer();
  const [phase, setPhase] = useState<"intro" | "playing" | "finished">("intro");
  const [challengeIndex, setChallengeIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [results, setResults] = useState<HackerResult[]>([]);
  const [transitioning, setTransitioning] = useState(false);
  const timerRef = useRef<number | null>(null);
  const challenge = HACKER_CHALLENGES[challengeIndex];
  const decoyLive = recognizer.predictions.some((prediction) =>
    isMatchingPrediction(challenge.decoy, prediction) && prediction.confidence >= 0.35,
  );

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function finishChallenge(drawing: DrawingSnapshot | null, solved: boolean) {
    if (transitioning) return;
    const targetPrediction = drawing?.predictions.find((prediction) => isMatchingPrediction(challenge.prompt, prediction));
    const award = solved
      ? Math.max(500, 1_500 - Math.max(0, (drawing?.strokeCount ?? 1) - 1) * 45 + Math.round((targetPrediction?.confidence ?? 0) * 100))
      : 0;
    const nextScore = score + award;
    setScore(nextScore);
    setResults((current) => [...current, { challenge, drawing, award }]);
    setTransitioning(true);
    timerRef.current = window.setTimeout(() => {
      if (challengeIndex + 1 >= HACKER_CHALLENGES.length) {
        setPhase("finished");
        setTransitioning(false);
        return;
      }
      recognizer.resetFeedback();
      setChallengeIndex((current) => current + 1);
      setTransitioning(false);
    }, solved ? 1_300 : 700);
  }

  function startRun() {
    recognizer.resetFeedback();
    setChallengeIndex(0);
    setScore(0);
    setResults([]);
    setTransitioning(false);
    setPhase("playing");
  }

  return (
    <ArcadeShell
      active="hacker"
      description="A correct drawing is not enough. Bend the same sketch through a specific decoy guess, then transform it into the real target."
      eyebrow="Wrong first. Right second."
      title="Model Hacker"
    >
      {phase === "intro" ? (
        <section className="arcade-intro panel hacker-intro">
          <div className="arcade-intro-mark"><DoodleDecoration color="#8a5fa8" size={72} type="bot" /></div>
          <p className="eyebrow">Five boss puzzles</p>
          <h2>Can you steer the machine?</h2>
          <p>Every puzzle has a decoy and a true target. Trigger the decoy first, then keep drawing until the AI recognizes the target. Clearing resets the trick.</p>
          <button className="button" disabled={recognizer.loadState !== "ready"} onClick={startRun} type="button">
            {recognizer.loadState === "ready" ? "Hack the first puzzle" : "Loading the AI…"}
          </button>
        </section>
      ) : phase === "playing" ? (
        <>
          <section className="hacker-brief panel">
            <span><small>Puzzle</small><strong>{challengeIndex + 1}/{HACKER_CHALLENGES.length}</strong></span>
            <div>
              <p>First make it say <mark>{challenge.decoy}</mark></p>
              <b aria-hidden="true">→</b>
              <p>Then make it say <mark>{challenge.prompt}</mark></p>
            </div>
            <span><small>Score</small><strong>{score}</strong></span>
          </section>
          <div className="arcade-play-grid">
            <DrawCanvas
              classify={recognizer.classify}
              disabled={transitioning || recognizer.loadState !== "ready" || Boolean(recognizer.error)}
              misdirectionTarget={challenge.decoy}
              mode="misdirection"
              onGuessStateChange={recognizer.setGuessState}
              onPredictions={recognizer.setPredictions}
              onRecognized={(drawing) => finishChallenge(drawing, true)}
              onSkip={(drawing) => finishChallenge(drawing, false)}
              prompt={challenge.prompt}
              promptId={`hacker:${challengeIndex}:${challenge.prompt}:${challenge.decoy}`}
              requireMisdirection
            />
            <aside className="arcade-side-panel">
              <div className={`hacker-lock ${decoyLive ? "armed" : ""}`}>
                <span aria-hidden="true">{decoyLive ? "✓" : "1"}</span>
                <p><strong>{decoyLive ? "Decoy detected" : `Waiting for “${challenge.decoy}”`}</strong>{challenge.hint}</p>
              </div>
              <ArcadeGuessRail guessState={recognizer.guessState} predictions={recognizer.predictions} />
            </aside>
          </div>
          <ArcadeError message={recognizer.error} />
        </>
      ) : (
        <section className="arcade-results panel">
          <p className="eyebrow">Hack complete</p>
          <h2>{results.every((result) => result.award > 0) ? "The model never stood a chance." : "A few puzzles fought back."}</h2>
          <strong className="arcade-final-score">{score}</strong>
          <p>{results.filter((result) => result.award > 0).length}/{HACKER_CHALLENGES.length} transformations landed</p>
          <div className="arcade-result-grid">
            {results.map((result) => (
              <article key={result.challenge.prompt}>
                {result.drawing ? <div style={{ backgroundImage: `url("${result.drawing.imageDataUrl}")` }} /> : <div className="empty" />}
                <span>
                  <strong>{result.challenge.decoy} → {result.challenge.prompt}</strong>
                  <small>{result.award ? `+${result.award}` : "skipped"}</small>
                </span>
              </article>
            ))}
          </div>
          <button className="button" onClick={startRun} type="button">Run the hacks again</button>
        </section>
      )}
    </ArcadeShell>
  );
}

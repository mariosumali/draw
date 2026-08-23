"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArcadeError, ArcadeGuessRail, ArcadeShell } from "@/components/game/ArcadeShell";
import { DrawCanvas } from "@/components/game/DrawCanvas";
import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { useArcadeRecognizer } from "@/hooks/useArcadeRecognizer";
import { createDailyPrompts, getDailyKey, scoreDailyPrompt } from "@/lib/game/experiences";
import { isMatchingPrediction } from "@/lib/game/guesses";
import type { DrawingSnapshot } from "@/lib/game/types";

const PROMPT_TIME_MS = 30_000;

type DailyResult = {
  drawing: DrawingSnapshot | null;
  prompt: string;
  solved: boolean;
  award: number;
};

export function DailyGauntlet() {
  const dailyKey = useMemo(() => getDailyKey(), []);
  const prompts = useMemo(() => createDailyPrompts(new Date(`${dailyKey}T12:00:00`)), [dailyKey]);
  const recognizer = useArcadeRecognizer();
  const [phase, setPhase] = useState<"intro" | "playing" | "finished">("intro");
  const [promptIndex, setPromptIndex] = useState(0);
  const [lives, setLives] = useState(3);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [results, setResults] = useState<DailyResult[]>([]);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [transitioning, setTransitioning] = useState(false);
  const transitionTimerRef = useRef<number | null>(null);
  const latestDrawingRef = useRef<DrawingSnapshot | null>(null);
  const resetRecognizerFeedback = recognizer.resetFeedback;

  const prompt = prompts[promptIndex];
  const remainingMs = phase === "playing" ? Math.max(0, deadline - now) : PROMPT_TIME_MS;

  useEffect(() => {
    const timer = window.setTimeout(() => setBestScore(readDailyBest(dailyKey)), 0);
    return () => window.clearTimeout(timer);
  }, [dailyKey]);

  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  const finishAttempt = useCallback((finalScore: number) => {
    setPhase("finished");
    setTransitioning(false);
    const nextBest = Math.max(bestScore, finalScore);
    setNewBest(finalScore > bestScore);
    setBestScore(nextBest);
    window.localStorage.setItem(
      `draw-battle:daily:${dailyKey}`,
      JSON.stringify({ bestScore: nextBest, completedAt: Date.now() }),
    );
  }, [bestScore, dailyKey]);

  const recordResult = useCallback((drawing: DrawingSnapshot | null, solved: boolean) => {
    if (phase !== "playing" || transitioning || !prompt) return;

    const match = drawing?.predictions.find((prediction) => isMatchingPrediction(prompt, prediction));
    const award = solved ? scoreDailyPrompt(Math.max(0, deadline - Date.now()), match?.confidence ?? 0) : 0;
    const nextLives = solved ? lives : Math.max(0, lives - 1);
    const nextScore = score + award;
    setResults((current) => [...current, { drawing, prompt, solved, award }]);
    setLives(nextLives);
    setScore(nextScore);
    setTransitioning(true);

    const holdMs = solved ? 1_300 : 700;
    transitionTimerRef.current = window.setTimeout(() => {
      if (nextLives === 0 || promptIndex + 1 >= prompts.length) {
        finishAttempt(nextScore);
        return;
      }
      resetRecognizerFeedback();
      latestDrawingRef.current = null;
      setPromptIndex((current) => current + 1);
      setNow(Date.now());
      setDeadline(Date.now() + PROMPT_TIME_MS);
      setTransitioning(false);
    }, holdMs);
  }, [deadline, finishAttempt, lives, phase, prompt, promptIndex, prompts.length, resetRecognizerFeedback, score, transitioning]);

  useEffect(() => {
    if (phase !== "playing" || transitioning) return;
    const timeout = window.setTimeout(
      () => recordResult(latestDrawingRef.current, false),
      Math.max(0, deadline - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [deadline, phase, recordResult, transitioning]);

  useEffect(() => () => {
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
  }, []);

  function startRun() {
    recognizer.resetFeedback();
    setPromptIndex(0);
    setLives(3);
    setScore(0);
    setResults([]);
    setNewBest(false);
    latestDrawingRef.current = null;
    setTransitioning(false);
    setNow(Date.now());
    setDeadline(Date.now() + PROMPT_TIME_MS);
    setPhase("playing");
  }

  return (
    <ArcadeShell
      active="daily"
      description="Everyone gets the same six prompts today. Solve quickly, protect three lives, and leave a score worth chasing."
      eyebrow={`Daily seed · ${dailyKey}`}
      title="Daily Gauntlet"
    >
      {phase === "intro" ? (
        <section className="arcade-intro panel">
          <div className="arcade-intro-mark"><DoodleDecoration color="#d88700" size={72} type="lightning" /></div>
          <p className="eyebrow">Today&apos;s run</p>
          <h2>Six prompts. Thirty seconds each.</h2>
          <p>Fast, confident solves pay more. A pass or timeout costs one of your three lives.</p>
          <div className="arcade-intro-stats">
            <span><strong>6</strong> prompts</span>
            <span><strong>3</strong> lives</span>
            <span><strong>{bestScore}</strong> daily best</span>
          </div>
          <button className="button" disabled={recognizer.loadState !== "ready"} onClick={startRun} type="button">
            {recognizer.loadState === "ready" ? "Start today's run" : "Loading the AI…"}
          </button>
        </section>
      ) : phase === "playing" ? (
        <>
          <section className="arcade-status-strip">
            <span><small>Prompt</small><strong>{promptIndex + 1}/{prompts.length}</strong></span>
            <span><small>Time</small><strong className={remainingMs <= 7_000 ? "urgent" : ""}>{Math.ceil(remainingMs / 1000)}s</strong></span>
            <span><small>Lives</small><strong aria-label={`${lives} lives`}>{"●".repeat(lives)}{"○".repeat(3 - lives)}</strong></span>
            <span><small>Score</small><strong>{score}</strong></span>
          </section>
          <div className="arcade-play-grid">
            <DrawCanvas
              classify={recognizer.classify}
              disabled={transitioning || recognizer.loadState !== "ready" || Boolean(recognizer.error)}
              meterLabel={`up to ${scoreDailyPrompt(remainingMs, 1)} pts`}
              mode="sprint"
              onGuessStateChange={recognizer.setGuessState}
              onPredictions={recognizer.setPredictions}
              onRecognized={(drawing) => recordResult(drawing, true)}
              onSkip={(drawing) => recordResult(drawing, false)}
              onSketchChange={(drawing) => { latestDrawingRef.current = drawing; }}
              onSketchClear={() => { latestDrawingRef.current = null; }}
              prompt={prompt}
              promptId={`${dailyKey}:${promptIndex}:${prompt}`}
            />
            <aside className="arcade-side-panel">
              <ArcadeGuessRail guessState={recognizer.guessState} predictions={recognizer.predictions} />
              <p className="arcade-tip"><strong>Daily tip</strong> Big silhouettes read faster than tiny details.</p>
            </aside>
          </div>
          <ArcadeError message={recognizer.error} />
        </>
      ) : (
        <section className="arcade-results panel">
          <p className="eyebrow">Run complete · {dailyKey}</p>
          <h2>{newBest ? "New daily best!" : "Gauntlet complete."}</h2>
          <strong className="arcade-final-score">{score}</strong>
          <p>{results.filter((result) => result.solved).length}/{prompts.length} solved · {lives} lives left</p>
          <div className="arcade-result-grid">
            {results.map((result, index) => (
              <article key={`${result.prompt}:${index}`}>
                {result.drawing ? <div style={{ backgroundImage: `url("${result.drawing.imageDataUrl}")` }} /> : <div className="empty" />}
                <span><strong>{result.prompt}</strong><small>{result.solved ? `+${result.award}` : "life lost"}</small></span>
              </article>
            ))}
          </div>
          <button className="button" onClick={startRun} type="button">Try again</button>
        </section>
      )}
    </ArcadeShell>
  );
}

function readDailyBest(dailyKey: string) {
  if (typeof window === "undefined") return 0;
  const saved = window.localStorage.getItem(`draw-battle:daily:${dailyKey}`);
  if (!saved) return 0;
  try {
    const record = JSON.parse(saved) as { bestScore?: number };
    return Math.max(0, record.bestScore ?? 0);
  } catch {
    window.localStorage.removeItem(`draw-battle:daily:${dailyKey}`);
    return 0;
  }
}

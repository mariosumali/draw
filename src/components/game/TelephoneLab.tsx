"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ArcadeError, ArcadeGuessRail, ArcadeShell } from "@/components/game/ArcadeShell";
import { DrawCanvas } from "@/components/game/DrawCanvas";
import { useArcadeRecognizer } from "@/hooks/useArcadeRecognizer";
import { getDailyKey } from "@/lib/game/experiences";
import { createPromptDeck } from "@/lib/game/prompts";
import type { DrawingSnapshot } from "@/lib/game/types";

const CHAIN_LENGTH = 4;

type TelephoneLink = {
  prompt: string;
  aiGuess: string;
  drawing: DrawingSnapshot;
};

export function TelephoneLab() {
  const seedPrompts = useMemo(() => createPromptDeck(`telephone-${getDailyKey()}`, 10), []);
  const recognizer = useArcadeRecognizer();
  const [seedIndex, setSeedIndex] = useState(0);
  const [prompt, setPrompt] = useState<string>(seedPrompts[0]);
  const [links, setLinks] = useState<TelephoneLink[]>([]);
  const [phase, setPhase] = useState<"playing" | "reveal">("playing");
  const [transitioning, setTransitioning] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function submitLink(drawing: DrawingSnapshot) {
    if (transitioning) return;
    const aiGuess = drawing.predictions[0]?.label || "mystery doodle";
    const nextLinks = [...links, { prompt, aiGuess, drawing }];
    setLinks(nextLinks);
    setTransitioning(true);
    timerRef.current = window.setTimeout(() => {
      if (nextLinks.length >= CHAIN_LENGTH) {
        setPhase("reveal");
        setTransitioning(false);
        return;
      }
      recognizer.resetFeedback();
      setPrompt(aiGuess);
      setTransitioning(false);
    }, 750);
  }

  function startFresh() {
    const nextSeedIndex = (seedIndex + 1) % seedPrompts.length;
    setSeedIndex(nextSeedIndex);
    setPrompt(seedPrompts[nextSeedIndex]);
    setLinks([]);
    setPhase("playing");
    setTransitioning(false);
    recognizer.resetFeedback();
  }

  const drifted = links.length > 0 && links[links.length - 1].aiGuess !== links[0].prompt;

  return (
    <ArcadeShell
      active="telephone"
      description="You draw the phrase, the AI renames your sketch, and its guess becomes the next phrase. Four handoffs reveal the drift."
      eyebrow="Experimental relay"
      title="AI Telephone"
    >
      {phase === "playing" ? (
        <>
          <section className="telephone-chain" aria-label="Telephone chain">
            <span className="telephone-seed"><small>Started as</small><strong>{links[0]?.prompt ?? prompt}</strong></span>
            {links.map((link, index) => (
              <span key={`${link.prompt}:${index}`}>
                <small>AI said</small>
                <strong>{link.aiGuess}</strong>
                <b aria-hidden="true">→</b>
              </span>
            ))}
            <span className="telephone-open-link"><small>Link</small><strong>{links.length + 1}/{CHAIN_LENGTH}</strong></span>
          </section>
          <div className="arcade-play-grid">
            <DrawCanvas
              classify={recognizer.classify}
              disabled={transitioning || recognizer.loadState !== "ready" || Boolean(recognizer.error)}
              manualActionLabel="Pass it to the AI"
              manualOutcomeLabel="Message passed"
              meterLabel={`link ${links.length + 1} of ${CHAIN_LENGTH}`}
              mode="sprint"
              onGuessStateChange={recognizer.setGuessState}
              onPredictions={recognizer.setPredictions}
              onRecognized={() => undefined}
              onSubmit={submitLink}
              prompt={prompt}
              promptId={`telephone:${links.length}:${prompt}`}
              recognitionMode="manual"
            />
            <aside className="arcade-side-panel">
              <ArcadeGuessRail guessState={recognizer.guessState} predictions={recognizer.predictions} />
              <p className="arcade-tip"><strong>Pass when ready</strong> The top live guess becomes your next drawing prompt—even when it is spectacularly wrong.</p>
            </aside>
          </div>
          <ArcadeError message={recognizer.error} />
        </>
      ) : (
        <section className="arcade-results telephone-reveal panel">
          <p className="eyebrow">Chain reveal</p>
          <h2>{drifted ? "The message mutated." : "Somehow, it survived."}</h2>
          <p><strong>{links[0]?.prompt}</strong> ended up as <strong>{links[links.length - 1]?.aiGuess}</strong>.</p>
          <div className="telephone-reveal-list">
            {links.map((link, index) => (
              <article key={`${link.prompt}:${index}`}>
                <header><span>Link {index + 1}</span><strong>{link.prompt} → {link.aiGuess}</strong></header>
                <div style={{ backgroundImage: `url("${link.drawing.imageDataUrl}")` }} role="img" aria-label={`Drawing prompted by ${link.prompt}`} />
                <p>
                  {link.drawing.predictions.slice(0, 3).map((prediction) => prediction.label).join(" · ") || "The AI had no words."}
                </p>
              </article>
            ))}
          </div>
          <button className="button" onClick={startFresh} type="button">Start a new chain</button>
        </section>
      )}
    </ArcadeShell>
  );
}

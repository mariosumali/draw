"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import { VoiceControl } from "@/components/ui/VoiceControl";
import type { AnimatedGuessSnapshot } from "@/hooks/useAnimatedGuesses";
import { GAME_EXPERIENCES, type GameExperience } from "@/lib/game/experiences";
import type { Prediction } from "@/lib/game/types";

export function ArcadeShell({
  active,
  children,
  description,
  eyebrow,
  title,
}: {
  active: GameExperience;
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className={`page-shell arcade-shell arcade-${active}`}>
      <header className="arcade-header">
        <div>
          <Link className="arcade-back" href="/">← all games</Link>
          <p className="eyebrow">
            <DoodleDecoration size={18} type={active === "daily" ? "lightning" : active === "gallery" ? "star" : "pencil"} />
            {eyebrow}
          </p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <VoiceControl compact />
      </header>
      <nav aria-label="Game directions" className="arcade-nav">
        {GAME_EXPERIENCES.filter((experience) => experience.id !== "party").map((experience) => (
          <Link className={experience.id === active ? "active" : ""} href={experience.href} key={experience.id}>
            <small>{experience.eyebrow}</small>
            <strong>{experience.name}</strong>
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}

export function ArcadeGuessRail({
  guessState,
  predictions,
}: {
  guessState: AnimatedGuessSnapshot;
  predictions: Prediction[];
}) {
  return (
    <section aria-label="Live AI guesses" className="arcade-guess-rail" aria-live="polite">
      <span>{guessState.status === "thinking" ? "AI is thinking…" : "AI sees"}</span>
      {predictions.slice(0, 5).map((prediction, index) => (
        <p className={index === 0 ? "active" : ""} key={prediction.label}>
          {prediction.label}
          <strong>{Math.round(prediction.confidence * 100)}%</strong>
        </p>
      ))}
      {!predictions.length && guessState.status !== "thinking" ? <em>Your guesses will appear here.</em> : null}
    </section>
  );
}

export function ArcadeError({ message }: { message: string | null }) {
  return message ? <p className="alert danger arcade-error" role="alert">{message}</p> : null;
}

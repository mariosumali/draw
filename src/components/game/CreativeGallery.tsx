"use client";

import { useEffect, useMemo, useState } from "react";

import { ArcadeError, ArcadeGuessRail, ArcadeShell } from "@/components/game/ArcadeShell";
import { DrawCanvas } from "@/components/game/DrawCanvas";
import { useArcadeRecognizer } from "@/hooks/useArcadeRecognizer";
import { createPromptDeck } from "@/lib/game/prompts";
import type { DrawingSnapshot } from "@/lib/game/types";

const GALLERY_STORAGE_KEY = "draw-battle:creative-gallery:v1";
const MAX_GALLERY_ITEMS = 16;

type GalleryEntry = {
  id: string;
  title: string;
  prompt: string;
  imageDataUrl: string;
  aiTitle: string;
  savedAt: number;
};

export function CreativeGallery() {
  const inspirations = useMemo(() => createPromptDeck("creative-gallery", 12), []);
  const recognizer = useArcadeRecognizer();
  const [inspirationIndex, setInspirationIndex] = useState(0);
  const [prompt, setPrompt] = useState<string>(inspirations[0]);
  const [promptRevision, setPromptRevision] = useState(0);
  const [title, setTitle] = useState("");
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEntries(readGallery());
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_GALLERY_ITEMS)));
  }, [entries, loaded]);

  function saveDrawing(drawing: DrawingSnapshot) {
    const aiTitle = drawing.predictions[0]?.label || "untitled mystery";
    const entry: GalleryEntry = {
      id: window.crypto.randomUUID(),
      title: title.trim() || prompt,
      prompt,
      imageDataUrl: drawing.imageDataUrl,
      aiTitle,
      savedAt: Date.now(),
    };
    setEntries((current) => [entry, ...current].slice(0, MAX_GALLERY_ITEMS));
    setTitle("");
  }

  function shuffleInspiration() {
    const nextIndex = (inspirationIndex + 1) % inspirations.length;
    setInspirationIndex(nextIndex);
    setPrompt(inspirations[nextIndex]);
    setPromptRevision((current) => current + 1);
    recognizer.resetFeedback();
  }

  function remix(entry: GalleryEntry) {
    setPrompt(entry.prompt);
    setTitle(`${entry.title} remix`);
    setPromptRevision((current) => current + 1);
    recognizer.resetFeedback();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <ArcadeShell
      active="gallery"
      description="No timer and no win state. Follow an inspiration—or argue with the live guesses—then title and keep the sketches you like."
      eyebrow="Unhurried creative sandbox"
      title="Creative Gallery"
    >
      <section className="gallery-controls panel">
        <div>
          <small>Inspiration card</small>
          <strong>{prompt}</strong>
          <button className="button secondary" onClick={shuffleInspiration} type="button">Shuffle prompt</button>
        </div>
        <label>
          <span>Title this piece</span>
          <input maxLength={48} onChange={(event) => setTitle(event.target.value)} placeholder={`Untitled ${prompt}`} value={title} />
        </label>
        <span><strong>{entries.length}/{MAX_GALLERY_ITEMS}</strong><small>local collection</small></span>
      </section>

      <div className="arcade-play-grid">
        <DrawCanvas
          classify={recognizer.classify}
          disabled={recognizer.loadState !== "ready" || Boolean(recognizer.error)}
          manualActionLabel="Save to gallery"
          manualOutcomeLabel="Added to your gallery"
          meterLabel="no timer · make it yours"
          mode="minimal"
          onGuessStateChange={recognizer.setGuessState}
          onPredictions={recognizer.setPredictions}
          onRecognized={() => undefined}
          onSubmit={saveDrawing}
          prompt={prompt}
          promptId={`gallery:${promptRevision}:${prompt}`}
          recognitionMode="manual"
        />
        <aside className="arcade-side-panel">
          <ArcadeGuessRail guessState={recognizer.guessState} predictions={recognizer.predictions} />
          <p className="arcade-tip"><strong>Creative nudge</strong> Treat a strange AI guess as a suggestion. Add the thing it sees and make a hybrid.</p>
        </aside>
      </div>
      <ArcadeError message={recognizer.error} />

      <section className="gallery-collection" aria-labelledby="gallery-title">
        <header>
          <div><p className="eyebrow">Saved on this device</p><h2 id="gallery-title">Your sketchbook</h2></div>
          <p>Newest first · capped at {MAX_GALLERY_ITEMS}</p>
        </header>
        {entries.length ? (
          <div className="gallery-grid">
            {entries.map((entry) => (
              <article key={entry.id}>
                <div style={{ backgroundImage: `url("${entry.imageDataUrl}")` }} role="img" aria-label={entry.title} />
                <header><strong>{entry.title}</strong><small>AI called it “{entry.aiTitle}”</small></header>
                <footer>
                  <button onClick={() => remix(entry)} type="button">Remix</button>
                  <a download={`${slugify(entry.title)}.png`} href={entry.imageDataUrl}>Download</a>
                  <button className="danger-text" onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} type="button">Remove</button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className="gallery-empty panel"><strong>Your first frame is waiting.</strong><p>Draw above, give it a title, and save it here.</p></div>
        )}
      </section>
    </ArcadeShell>
  );
}

function isGalleryEntry(value: unknown): value is GalleryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<GalleryEntry>;
  return typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.prompt === "string" && typeof entry.imageDataUrl === "string";
}

function readGallery() {
  if (typeof window === "undefined") return [];
  const stored = window.localStorage.getItem(GALLERY_STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as GalleryEntry[];
    return parsed.filter(isGalleryEntry).slice(0, MAX_GALLERY_ITEMS);
  } catch {
    window.localStorage.removeItem(GALLERY_STORAGE_KEY);
    return [];
  }
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "drawing";
}

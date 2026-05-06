"use client";

import { DoodleDecoration } from "@/components/ui/DoodleDecoration";
import type { PlayerState } from "@/lib/game/types";

type PromptListProps = {
  prompts: string[];
  player: PlayerState | undefined;
};

export function PromptList({ prompts, player }: PromptListProps) {
  const currentIndex = player?.promptIndex ?? 0;

  return (
    <section className="side-card panel">
      <h2>
        <DoodleDecoration type="pencil" size={22} rotate={-15} style={{ marginRight: 6, verticalAlign: "middle" }} />
        Sketch list
      </h2>
      <ol className="prompt-list">
        {prompts.slice(0, 10).map((prompt, index) => {
          const completed = player ? index < player.promptIndex : false;
          const current = index === currentIndex;
          return (
            <li className={completed ? "complete" : current ? "current" : ""} key={prompt}>
              <span>
                {completed && (
                  <DoodleDecoration type="checkmark" size={18} color="#4caf50" style={{ marginRight: 6, verticalAlign: "middle" }} />
                )}
                {current && (
                  <DoodleDecoration type="arrow" size={20} color="#e53935" style={{ marginRight: 6, verticalAlign: "middle" }} />
                )}
                {prompt}
              </span>
              <small>{completed ? "done!" : current ? "now!" : "next"}</small>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

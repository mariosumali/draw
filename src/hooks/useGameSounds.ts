import { useCallback, useEffect, useRef } from "react";

import { startLobbyMusic, stopLobbyMusic } from "@/lib/audio/music";
import {
  playClick,
  playCountdownTick,
  playGo,
  playLose,
  playRecognized,
  playTie,
  playWin,
} from "@/lib/audio/sfx";
import type { GamePhase, GameState, PlayerState } from "@/lib/game/types";

type UseGameSoundsOptions = {
  gameState: GameState | null;
  localPlayer: PlayerState | undefined;
  receivedAt: number;
};

export function useGameSounds({
  gameState,
  localPlayer,
  receivedAt,
}: UseGameSoundsOptions) {
  const prevPhaseRef = useRef<GamePhase | null>(null);
  const prevScoreRef = useRef(0);
  const countdownTickedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!gameState) return;

    const prevPhase = prevPhaseRef.current;
    const phase = gameState.phase;

    if (prevPhase !== phase) {
      // Phase transitions
      if (phase === "waiting") {
        startLobbyMusic();
        countdownTickedRef.current.clear();
      }

      if (prevPhase === "waiting" && phase === "countdown") {
        stopLobbyMusic();
        countdownTickedRef.current.clear();
      }

      if (prevPhase === "countdown" && phase === "playing") {
        playGo();
      }

      if (phase === "finished") {
        stopLobbyMusic();
        const isTie = !gameState.winnerId;
        const localWon = localPlayer?.id === gameState.winnerId;

        if (isTie) {
          playTie();
        } else if (localWon) {
          playWin();
        } else {
          playLose();
        }
      }

      prevPhaseRef.current = phase;
    }
  }, [gameState, localPlayer?.id]);

  // Countdown ticks: fire once per displayed second (3, 2, 1)
  useEffect(() => {
    if (!gameState || gameState.phase !== "countdown" || !gameState.countdownStartedAt) return;

    const tick = () => {
      const elapsed = Date.now() - receivedAt;
      const serverNow = gameState.serverNow + Math.max(0, elapsed);
      const countdownMs = Math.max(0, gameState.countdownStartedAt! + 3_000 - serverNow);
      const secondsLeft = Math.ceil(countdownMs / 1000);

      if (secondsLeft >= 1 && secondsLeft <= 3 && !countdownTickedRef.current.has(secondsLeft)) {
        countdownTickedRef.current.add(secondsLeft);
        playCountdownTick(secondsLeft);
      }
    };

    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [gameState, receivedAt]);

  // Score increase detection
  useEffect(() => {
    const score = localPlayer?.score ?? 0;
    if (score > prevScoreRef.current && prevScoreRef.current > 0) {
      playRecognized();
    }
    // Also play on first score (when game just started and you get first recognition)
    if (score > 0 && prevScoreRef.current === 0 && gameState?.phase === "playing") {
      playRecognized();
    }
    prevScoreRef.current = score;
  }, [localPlayer?.score, gameState?.phase]);

  const onClickSound = useCallback(() => {
    playClick();
  }, []);

  return { playClick: onClickSound };
}

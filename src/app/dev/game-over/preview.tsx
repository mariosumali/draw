"use client";

import { ResultPanel } from "@/components/game/ResultPanel";
import type { DrawingSnapshot, GameState, PlayerState } from "@/lib/game/types";

const players: PlayerState[] = [
  player("local-player", "You", 0, 5),
  player("player-2", "Mina", 1, 4),
  player("player-3", "Theo", 2, 2),
];

const drawings: DrawingSnapshot[] = [
  drawing("0:cat", "cat", "M 54 118 C 56 74 91 44 130 58 C 162 38 207 51 224 86 C 251 94 268 119 262 148 C 254 190 201 202 151 197 C 91 202 48 177 54 118 Z M 102 99 L 119 121 M 189 99 L 172 121 M 117 151 C 138 168 174 168 195 151", true, 0.91, 1),
  drawing("1:tree", "tree", "M 151 204 L 151 124 M 151 142 C 107 139 72 114 76 82 C 81 45 127 43 146 64 C 160 25 220 31 229 73 C 267 78 281 117 251 142 C 229 161 190 156 151 142 M 131 204 L 178 204", true, 0.86, 2),
  drawing("2:bike", "bicycle", "M 87 169 A 41 41 0 1 0 88 169 M 217 169 A 41 41 0 1 0 218 169 M 88 169 L 134 108 L 174 169 L 119 169 L 154 132 L 200 132 M 134 108 L 128 86 M 190 112 L 207 91", false, 0.52, 3),
];

const state: GameState = {
  roomId: "preview",
  phase: "finished",
  players,
  spectators: 0,
  chatMessages: [],
  prompts: ["cat", "tree", "bicycle", "pizza", "moon"],
  maxPlayers: 3,
  roundDurationMs: 90_000,
  serverNow: Date.now(),
  winnerId: "local-player",
};

export function GameOverPreview() {
  return (
    <main className="page-shell room-shell">
      <header className="room-header panel">
        <div>
          <p className="eyebrow">Dev preview</p>
          <h1>Game over screen</h1>
        </div>
      </header>
      <ResultPanel
        drawings={drawings}
        localPlayer={players[0]}
        onReset={() => window.alert("Preview rematch requested.")}
        state={state}
      />
    </main>
  );
}

function player(id: string, name: string, slot: number, score: number): PlayerState {
  return {
    id,
    name,
    slot,
    score,
    ready: false,
    connected: true,
    promptIndex: score,
    completedPrompts: [],
    lastSeen: Date.now(),
  };
}

function drawing(id: string, prompt: string, path: string, recognized: boolean, confidence: number, order: number): DrawingSnapshot {
  return {
    id,
    prompt,
    recognized,
    imageDataUrl: svgDataUrl(path),
    predictions: [{ label: prompt, confidence }],
    savedAt: order,
  };
}

function svgDataUrl(path: string) {
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 240">
      <rect width="300" height="240" fill="#fffef9"/>
      <path d="${path}" fill="none" stroke="#1a1a1a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `)}`;
}

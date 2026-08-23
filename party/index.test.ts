import type * as Party from "partykit/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DrawBattleRoom from "./index";
import { COUNTDOWN_MS, ROUND_REVEAL_MS, type GameState, type ServerMessage } from "../src/lib/game/types";

type ServerConnection = Parameters<DrawBattleRoom["onConnect"]>[0];

describe("Party Show room", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T18:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds a shared prompt until everyone submits, then reveals and rotates rules", () => {
    const broadcasts: string[] = [];
    const connections: FakeConnection[] = [];
    const room = {
      id: "party-test",
      broadcast(message: string) {
        broadcasts.push(message);
      },
      getConnections() {
        return connections;
      },
    } as unknown as Party.Room;
    const server = new DrawBattleRoom(room);
    const first = fakeConnection("one");
    const second = fakeConnection("two");
    connections.push(first, second);

    server.onConnect(first as unknown as ServerConnection);
    server.onConnect(second as unknown as ServerConnection);
    send(server, first, { type: "join", playerId: "p1", name: "Mira" });
    send(server, second, { type: "join", playerId: "p2", name: "Theo" });
    send(server, first, { type: "ready", playerId: "p1", ready: true });
    send(server, second, { type: "ready", playerId: "p2", ready: true });

    expect(latestState(broadcasts).phase).toBe("countdown");
    vi.advanceTimersByTime(COUNTDOWN_MS);
    const playing = latestState(broadcasts);
    expect(playing.phase).toBe("playing");
    expect(playing.roundIndex).toBe(0);
    const prompt = playing.prompts[0];

    complete(server, first, "p1", prompt);
    expect(latestState(broadcasts).phase).toBe("playing");
    expect(latestState(broadcasts).players.find((player) => player.id === "p1")?.roundDone).toBe(true);
    expect(latestState(broadcasts).players.find((player) => player.id === "p2")?.roundDone).toBe(false);

    complete(server, second, "p2", prompt);
    const reveal = latestState(broadcasts);
    expect(reveal.phase).toBe("reveal");
    expect(reveal.roundSubmissions).toHaveLength(2);
    expect(reveal.roundHistory[0].mode).toBe("sprint");
    expect(reveal.players.map((player) => player.score)).toEqual([100, 100]);

    vi.advanceTimersByTime(ROUND_REVEAL_MS);
    expect(latestState(broadcasts).phase).toBe("countdown");
    expect(latestState(broadcasts).roundIndex).toBe(1);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(latestState(broadcasts).phase).toBe("playing");
  });
});

type FakeConnection = {
  id: string;
  state?: { playerId?: string; spectator?: boolean };
  sent: string[];
  send(message: string): void;
  setState(state: { playerId?: string; spectator?: boolean }): void;
};

function fakeConnection(id: string): FakeConnection {
  return {
    id,
    sent: [],
    send(message) {
      this.sent.push(message);
    },
    setState(state) {
      this.state = state;
    },
  };
}

function send(server: DrawBattleRoom, connection: FakeConnection, message: object) {
  server.onMessage(JSON.stringify(message), connection as unknown as ServerConnection);
}

function complete(server: DrawBattleRoom, connection: FakeConnection, playerId: string, prompt: string) {
  send(server, connection, {
    type: "completePrompt",
    playerId,
    prompt,
    confidence: 0.9,
    predictions: [{ label: prompt, confidence: 0.9 }],
    strokeCount: 3,
    misdirected: false,
    imageDataUrl: "data:image/png;base64,YQ==",
  });
}

function latestState(messages: string[]) {
  const message = JSON.parse(messages.at(-1) ?? "{}") as ServerMessage;
  if (message.type !== "state") throw new Error("Expected a state broadcast");
  return message.state as GameState;
}

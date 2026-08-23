import type * as Party from "partykit/server";

import { createPromptDeck } from "../src/lib/game/prompts";
import { DEFAULT_GAME_MODE, getRoundMode, isGameMode, scorePrompt } from "../src/lib/game/modes";
import {
  COUNTDOWN_MS,
  DEFAULT_MAX_PLAYERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MAX_ROUND_DURATION_MS,
  MIN_ROUND_DURATION_MS,
  PARTY_ROUND_COUNT,
  ROUND_DURATION_MS,
  ROUND_REVEAL_MS,
  RECOGNITION_TOP_N,
  getWinnerId,
  isRecognizedPrompt,
  normalizeLabel,
  type ClientMessage,
  type GameState,
  type PlayerState,
  type ServerMessage,
} from "../src/lib/game/types";

type ConnectionState = {
  playerId?: string;
  spectator?: boolean;
};

export default class DrawBattleRoom implements Party.Server {
  private state: GameState;
  private countdownTimer: ReturnType<typeof setTimeout> | undefined;
  private finishTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly room: Party.Room) {
    this.state = this.createInitialState();
  }

  onConnect(connection: Party.Connection<ConnectionState>) {
    connection.setState({ spectator: true });
    this.send(connection, { type: "state", state: this.snapshot(), spectator: true });
  }

  onMessage(rawMessage: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection<ConnectionState>) {
    if (typeof rawMessage !== "string") {
      this.send(sender, { type: "error", message: "Unsupported message format." });
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(rawMessage) as ClientMessage;
    } catch {
      this.send(sender, { type: "error", message: "Invalid JSON message." });
      return;
    }

    if (message.type === "join") {
      this.joinPlayer(sender, message.playerId, message.name);
      return;
    }

    if (!this.isConnectionPlayer(sender, message.playerId)) {
      this.send(sender, { type: "error", message: "You are not an active player in this room." });
      return;
    }

    if (message.type === "ready") {
      this.setReady(message.playerId, message.ready);
      return;
    }

    if (message.type === "updateSettings") {
      this.updateSettings(message);
      return;
    }

    if (message.type === "deleteLobby") {
      this.deleteLobby();
      return;
    }

    if (message.type === "sendChat") {
      this.sendChat(message);
      return;
    }

    if (message.type === "completePrompt") {
      this.completePrompt(message);
      return;
    }

    if (message.type === "skipPrompt") {
      this.skipPrompt(message);
      return;
    }

    if (message.type === "reset") {
      this.resetRoom();
    }
  }

  onClose(connection: Party.Connection<ConnectionState>) {
    this.disconnect(connection);
  }

  onError(connection: Party.Connection<ConnectionState>) {
    this.disconnect(connection);
  }

  private joinPlayer(connection: Party.Connection<ConnectionState>, playerId: string, rawName: string) {
    const name = rawName.trim().slice(0, 24) || "Player";
    const existingPlayer = this.state.players.find((player) => player.id === playerId);

    if (existingPlayer) {
      existingPlayer.name = name;
      existingPlayer.connected = true;
      existingPlayer.lastSeen = Date.now();
      connection.setState({ playerId, spectator: false });
      this.broadcastState();
      return;
    }

    if (this.state.players.length >= this.state.maxPlayers || this.state.phase !== "waiting") {
      connection.setState({ spectator: true });
      this.send(connection, {
        type: "state",
        state: this.snapshot(),
        playerId,
        spectator: true,
      });
      return;
    }

    const player: PlayerState = {
      id: playerId,
      name,
      slot: this.state.players.length,
      ready: false,
      connected: true,
      score: 0,
      promptIndex: 0,
      completedPrompts: [],
      roundDone: false,
      lastAward: 0,
      lastSeen: Date.now(),
    };

    this.state.players.push(player);
    connection.setState({ playerId, spectator: false });
    this.broadcastState();
  }

  private setReady(playerId: string, ready: boolean) {
    if (this.state.phase !== "waiting") {
      return;
    }

    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return;
    }

    player.ready = ready;
    player.lastSeen = Date.now();
    this.broadcastState();

    const connectedPlayers = this.state.players.filter((candidate) => candidate.connected);
    const canStart =
      connectedPlayers.length === this.state.maxPlayers &&
      connectedPlayers.every((candidate) => candidate.ready);

    if (canStart) {
      this.startCountdown();
    }
  }

  private updateSettings(message: Extract<ClientMessage, { type: "updateSettings" }>) {
    if (this.state.phase !== "waiting") {
      return;
    }

    const player = this.state.players.find((candidate) => candidate.id === message.playerId);
    if (!player || !player.connected) {
      return;
    }

    let changed = false;
    if (typeof message.maxPlayers === "number") {
      const minimumPlayers = Math.max(MIN_PLAYERS, this.state.players.length);
      const maxPlayers = clamp(Math.round(message.maxPlayers), minimumPlayers, MAX_PLAYERS);
      if (maxPlayers !== this.state.maxPlayers) {
        this.state.maxPlayers = maxPlayers;
        changed = true;
      }
    }

    if (typeof message.roundDurationMs === "number") {
      const roundDurationMs = clamp(
        Math.round(message.roundDurationMs),
        MIN_ROUND_DURATION_MS,
        MAX_ROUND_DURATION_MS,
      );
      if (roundDurationMs !== this.state.roundDurationMs) {
        this.state.roundDurationMs = roundDurationMs;
        changed = true;
      }
    }

    if (isGameMode(message.mode) && message.mode !== this.state.mode) {
      this.state.mode = message.mode;
      changed = true;
    }

    if (changed) {
      this.state.players.forEach((candidate) => {
        candidate.ready = false;
      });
      this.broadcastState();
    }
  }

  private deleteLobby() {
    if (this.state.phase !== "waiting") {
      return;
    }

    this.clearTimers();
    this.state = this.createInitialState();

    for (const connection of this.room.getConnections<ConnectionState>()) {
      connection.setState({ spectator: true });
    }

    const message: ServerMessage = { type: "lobbyDeleted" };
    this.room.broadcast(JSON.stringify(message));
  }

  private sendChat(message: Extract<ClientMessage, { type: "sendChat" }>) {
    const player = this.state.players.find((candidate) => candidate.id === message.playerId);
    const text = message.text.trim().replace(/\s+/g, " ").slice(0, 180);
    if (!player || !text) {
      return;
    }

    const sentAt = Date.now();
    this.state.chatMessages = [
      ...this.state.chatMessages,
      {
        id: `${sentAt}-${message.playerId}-${this.state.chatMessages.length}`,
        playerId: message.playerId,
        playerName: player.name,
        text,
        sentAt,
      },
    ].slice(-50);
    player.lastSeen = sentAt;
    this.broadcastState();
  }

  private completePrompt(message: Extract<ClientMessage, { type: "completePrompt" }>) {
    if (this.state.phase !== "playing") {
      return;
    }

    const player = this.state.players.find((candidate) => candidate.id === message.playerId);
    if (!player || player.roundDone) {
      return;
    }

    const currentPrompt = this.state.prompts[this.state.roundIndex];
    if (!currentPrompt || currentPrompt !== message.prompt) {
      return;
    }

    if (!isRecognizedPrompt(currentPrompt, message.predictions)) {
      return;
    }

    const normalizedPrompt = normalizeLabel(currentPrompt);
    const matchedPrediction = message.predictions
      .slice(0, RECOGNITION_TOP_N)
      .find((prediction) => normalizeLabel(prediction.label) === normalizedPrompt);
    const roundMode = getRoundMode(this.state.mode, this.state.roundIndex);
    const award = scorePrompt(roundMode, {
      confidence: matchedPrediction?.confidence ?? 0,
      strokeCount: message.strokeCount ?? 99,
      misdirected: Boolean(message.misdirected),
    });

    player.score += award;
    player.completedPrompts.push(currentPrompt);
    player.roundDone = true;
    player.lastAward = award;
    player.lastSeen = Date.now();
    this.state.roundSubmissions.push({
      playerId: player.id,
      playerName: player.name,
      prompt: currentPrompt,
      recognized: true,
      award,
      confidence: matchedPrediction?.confidence ?? 0,
      strokeCount: clamp(Math.round(message.strokeCount ?? 99), 0, 99),
      misdirected: Boolean(message.misdirected),
      imageDataUrl: sanitizeImageDataUrl(message.imageDataUrl),
      predictions: sanitizePredictions(message.predictions),
      submittedAt: Date.now(),
    });

    this.broadcastState();
    this.revealWhenEveryoneIsDone();
  }

  private skipPrompt(message: Extract<ClientMessage, { type: "skipPrompt" }>) {
    if (this.state.phase !== "playing") {
      return;
    }

    const player = this.state.players.find((candidate) => candidate.id === message.playerId);
    if (!player || player.roundDone) {
      return;
    }

    const currentPrompt = this.state.prompts[this.state.roundIndex];
    if (!currentPrompt || currentPrompt !== message.prompt) {
      return;
    }

    player.roundDone = true;
    player.lastAward = 0;
    player.lastSeen = Date.now();
    this.state.roundSubmissions.push({
      playerId: player.id,
      playerName: player.name,
      prompt: currentPrompt,
      recognized: false,
      award: 0,
      confidence: 0,
      strokeCount: clamp(Math.round(message.strokeCount ?? 0), 0, 99),
      misdirected: Boolean(message.misdirected),
      imageDataUrl: sanitizeImageDataUrl(message.imageDataUrl),
      predictions: sanitizePredictions(message.predictions ?? []),
      submittedAt: Date.now(),
    });
    this.broadcastState();
    this.revealWhenEveryoneIsDone();
  }

  private startCountdown() {
    if (this.state.phase !== "waiting") {
      return;
    }

    this.state.phase = "countdown";
    this.state.countdownStartedAt = Date.now();
    this.broadcastState();

    this.countdownTimer = setTimeout(() => {
      this.startRound();
    }, COUNTDOWN_MS);
  }

  private startRound() {
    if (this.state.phase !== "countdown") {
      return;
    }

    const now = Date.now();
    this.state.phase = "playing";
    this.state.startedAt = now;
    this.state.endsAt = now + this.state.roundDurationMs;
    delete this.state.revealEndsAt;
    this.state.players.forEach((player) => {
      player.roundDone = false;
      player.lastAward = 0;
    });
    this.broadcastState();

    this.finishTimer = setTimeout(() => {
      this.beginReveal();
    }, this.state.roundDurationMs);
  }

  private revealWhenEveryoneIsDone() {
    const activePlayers = this.state.players.filter((player) => player.connected);
    if (activePlayers.length > 0 && activePlayers.every((player) => player.roundDone)) {
      this.beginReveal();
    }
  }

  private beginReveal() {
    if (this.state.phase !== "playing") {
      return;
    }

    this.clearTimers();
    const prompt = this.state.prompts[this.state.roundIndex];
    for (const player of this.state.players.filter((candidate) => candidate.connected && !candidate.roundDone)) {
      player.roundDone = true;
      player.lastAward = 0;
      this.state.roundSubmissions.push({
        playerId: player.id,
        playerName: player.name,
        prompt,
        recognized: false,
        award: 0,
        confidence: 0,
        strokeCount: 0,
        misdirected: false,
        predictions: [],
        submittedAt: Date.now(),
      });
    }

    this.state.phase = "reveal";
    this.state.revealEndsAt = Date.now() + ROUND_REVEAL_MS;
    delete this.state.endsAt;
    this.state.roundHistory.push({
      roundIndex: this.state.roundIndex,
      prompt,
      mode: getRoundMode(this.state.mode, this.state.roundIndex),
      submissions: this.state.roundSubmissions.map((submission) => ({ ...submission })),
    });
    this.broadcastState();

    this.finishTimer = setTimeout(() => {
      this.advanceRound();
    }, ROUND_REVEAL_MS);
  }

  private advanceRound() {
    if (this.state.phase !== "reveal") {
      return;
    }

    if (this.state.roundIndex + 1 >= this.state.roundCount) {
      this.finishGame();
      return;
    }

    this.clearTimers();
    this.state.roundIndex += 1;
    this.state.roundSubmissions = [];
    this.state.phase = "countdown";
    this.state.countdownStartedAt = Date.now();
    delete this.state.revealEndsAt;
    this.state.players.forEach((player) => {
      player.promptIndex = this.state.roundIndex;
      player.roundDone = false;
      player.lastAward = 0;
    });
    this.broadcastState();
    this.countdownTimer = setTimeout(() => {
      this.startRound();
    }, COUNTDOWN_MS);
  }

  private finishGame() {
    this.clearTimers();
    this.state.phase = "finished";
    this.state.winnerId = getWinnerId(this.state.players);
    delete this.state.revealEndsAt;
    this.broadcastState();
  }

  private resetRoom() {
    this.clearTimers();
    const previousPlayers = this.state.players;
    const { maxPlayers, mode, roundDurationMs } = this.state;
    this.state = this.createInitialState({ maxPlayers, mode, roundDurationMs });
    this.state.players = previousPlayers.map((player, slot) => ({
      ...player,
      slot,
      ready: false,
      score: 0,
      promptIndex: 0,
      completedPrompts: [],
      roundDone: false,
      lastAward: 0,
      lastSeen: Date.now(),
    }));

    this.broadcastState();
  }

  private disconnect(connection: Party.Connection<ConnectionState>) {
    const playerId = connection.state?.playerId;
    if (!playerId) {
      return;
    }

    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return;
    }

    player.connected = false;
    player.ready = false;
    player.lastSeen = Date.now();

    if (this.state.phase === "countdown") {
      this.state.phase = "waiting";
      delete this.state.countdownStartedAt;
      this.clearTimers();
    }

    if (this.state.phase === "playing") {
      this.revealWhenEveryoneIsDone();
    }

    if (this.state.phase === "waiting") {
      this.state.players = this.state.players.filter((candidate) => candidate.connected);
      this.state.players.forEach((candidate, slot) => {
        candidate.slot = slot;
        candidate.ready = false;
        candidate.lastSeen = Date.now();
      });
    }

    this.broadcastState();
  }

  private isConnectionPlayer(connection: Party.Connection<ConnectionState>, playerId: string) {
    return connection.state?.playerId === playerId && connection.state?.spectator === false;
  }

  private createInitialState(settings?: Pick<GameState, "maxPlayers" | "mode" | "roundDurationMs">): GameState {
    return {
      roomId: this.room.id,
      phase: "waiting",
      players: [],
      spectators: 0,
      chatMessages: [],
      prompts: createPromptDeck(`${this.room.id}-${Date.now()}`),
      mode: settings?.mode ?? DEFAULT_GAME_MODE,
      roundIndex: 0,
      roundCount: PARTY_ROUND_COUNT,
      roundSubmissions: [],
      roundHistory: [],
      maxPlayers: settings?.maxPlayers ?? DEFAULT_MAX_PLAYERS,
      roundDurationMs: settings?.roundDurationMs ?? ROUND_DURATION_MS,
      serverNow: Date.now(),
    };
  }

  private snapshot(): GameState {
    return {
      ...this.state,
      players: this.state.players.map((player) => ({ ...player })),
      chatMessages: this.state.chatMessages.map((message) => ({ ...message })),
      spectators: this.countSpectators(),
      serverNow: Date.now(),
    };
  }

  private countSpectators() {
    let spectators = 0;
    for (const connection of this.room.getConnections<ConnectionState>()) {
      if (connection.state?.spectator !== false) {
        spectators += 1;
      }
    }
    return spectators;
  }

  private broadcastState() {
    const message: ServerMessage = { type: "state", state: this.snapshot() };
    this.room.broadcast(JSON.stringify(message));
  }

  private send(connection: Party.Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }

  private clearTimers() {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
    }
    if (this.finishTimer) {
      clearTimeout(this.finishTimer);
    }
    this.countdownTimer = undefined;
    this.finishTimer = undefined;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeImageDataUrl(value: string | undefined) {
  if (!value || value.length > 400_000 || !/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(value)) {
    return undefined;
  }
  return value;
}

function sanitizePredictions(predictions: { label: string; confidence: number }[]) {
  return predictions.slice(0, RECOGNITION_TOP_N).map((prediction) => ({
    label: prediction.label.trim().slice(0, 64),
    confidence: clamp(Number.isFinite(prediction.confidence) ? prediction.confidence : 0, 0, 1),
  }));
}

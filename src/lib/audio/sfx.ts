import { SoundEngine } from "./sound-engine";

// --- note frequencies (Hz) ---
const C4 = 261.63;
const D4 = 293.66;
const E4 = 329.63;
const G4 = 392.0;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

type OscType = OscillatorType;

const DRAWING_SOUND_IDLE_MS = 85;
const DRAWING_SOUND_VOLUME = 0.08;

let drawingScratchBuffer: AudioBuffer | null = null;
let drawingSource: AudioBufferSourceNode | null = null;
let drawingGain: GainNode | null = null;
let drawingFilter: BiquadFilterNode | null = null;
let drawingIdleTimer: ReturnType<typeof setTimeout> | null = null;

function tone(
  freq: number,
  duration: number,
  type: OscType = "sine",
  volume = 0.3,
  startDelay = 0,
) {
  const ctx = SoundEngine.getContext();
  const master = SoundEngine.getMasterGain();
  const now = ctx.currentTime + startDelay;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(master);

  osc.start(now);
  osc.stop(now + duration);
}

function chord(
  freqs: number[],
  duration: number,
  type: OscType = "sine",
  volume = 0.15,
  startDelay = 0,
) {
  for (const freq of freqs) {
    tone(freq, duration, type, volume, startDelay);
  }
}

function getDrawingScratchBuffer(ctx: AudioContext) {
  if (drawingScratchBuffer) {
    return drawingScratchBuffer;
  }

  const bufferSize = Math.floor(ctx.sampleRate * 0.28);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    const scrapePattern = 0.25 + Math.abs(Math.sin(i * 0.014)) * 0.3;
    const grain = Math.random() * 2 - 1;
    const roughEdge = Math.random() > 0.94 ? Math.random() * 2 - 1 : 0;
    data[i] = (grain * 0.28 + roughEdge * 0.18) * scrapePattern;
  }

  drawingScratchBuffer = buffer;
  return buffer;
}

export function startDrawingSound() {
  if (drawingSource) {
    return;
  }

  const ctx = SoundEngine.getContext();
  const master = SoundEngine.getMasterGain();
  const now = ctx.currentTime;

  const source = ctx.createBufferSource();
  source.buffer = getDrawingScratchBuffer(ctx);
  source.loop = true;
  source.playbackRate.value = 0.95 + Math.random() * 0.12;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(DRAWING_SOUND_VOLUME, now + 0.06);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  drawingSource = source;
  drawingGain = gain;
  drawingFilter = filter;

  source.start(now);
}

export function playDrawingMovementSound() {
  if (drawingIdleTimer) {
    clearTimeout(drawingIdleTimer);
  }

  startDrawingSound();
  drawingIdleTimer = setTimeout(() => {
    drawingIdleTimer = null;
    stopDrawingSound();
  }, DRAWING_SOUND_IDLE_MS);
}

export function stopDrawingSound() {
  if (drawingIdleTimer) {
    clearTimeout(drawingIdleTimer);
    drawingIdleTimer = null;
  }

  if (!drawingSource || !drawingGain || !drawingFilter) {
    return;
  }

  const ctx = SoundEngine.getContext();
  const source = drawingSource;
  const gain = drawingGain;
  const filter = drawingFilter;
  const now = ctx.currentTime;

  drawingSource = null;
  drawingGain = null;
  drawingFilter = null;

  gain.gain.cancelScheduledValues(now);
  gain.gain.setTargetAtTime(0.001, now, 0.03);
  source.stop(now + 0.12);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

export function playClick() {
  const ctx = SoundEngine.getContext();
  const master = SoundEngine.getMasterGain();
  const now = ctx.currentTime;

  const bufferSize = ctx.sampleRate * 0.04;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  source.start(now);
  source.stop(now + 0.05);
}

export function playCountdownTick(secondsLeft: number) {
  const pitches = [C5, E5, G5];
  const freq = pitches[Math.min(3 - secondsLeft, pitches.length - 1)] ?? C5;
  tone(freq, 0.15, "sine", 0.35);
}

export function playGo() {
  chord([C4, E4, G4, C5], 0.35, "triangle", 0.2);
}

export function playRecognized() {
  tone(G5, 0.12, "triangle", 0.3, 0);
  tone(C6, 0.2, "triangle", 0.3, 0.1);
}

export function playWin() {
  const notes = [C4, E4, G4, C5];
  for (let i = 0; i < notes.length; i++) {
    tone(notes[i], 0.35, "triangle", 0.25, i * 0.12);
  }
}

export function playLose() {
  const notes = [E4, D4, C4];
  for (let i = 0; i < notes.length; i++) {
    tone(notes[i], 0.35, "sine", 0.18, i * 0.15);
  }
}

export function playTie() {
  tone(G4, 0.2, "triangle", 0.22, 0);
  tone(C4, 0.3, "sine", 0.22, 0.18);
}

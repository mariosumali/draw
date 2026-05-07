import { SoundEngine } from "./sound-engine";

const MUSIC_PATH = "/audio/lobby-music.mp3";
const MUSIC_VOLUME = 0.36;
const FADE_DURATION = 1;

let audioBuffer: AudioBuffer | null = null;
let loadingPromise: Promise<AudioBuffer> | null = null;
let source: AudioBufferSourceNode | null = null;
let gainNode: GainNode | null = null;
let starting = false;
let playing = false;
let startToken = 0;

async function loadBuffer(): Promise<AudioBuffer> {
  if (audioBuffer) return audioBuffer;

  if (!loadingPromise) {
    loadingPromise = (async () => {
      const ctx = SoundEngine.getContext();
      const response = await fetch(MUSIC_PATH);
      if (!response.ok) {
        throw new Error(`Failed to load lobby music: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      return audioBuffer;
    })().finally(() => {
      loadingPromise = null;
    });
  }

  return loadingPromise;
}

export async function startLobbyMusic() {
  if (playing || starting) return;

  starting = true;
  const token = ++startToken;

  try {
    const buffer = await loadBuffer();
    const ctx = SoundEngine.getContext();
    const master = SoundEngine.getMasterGain();

    if (token !== startToken || playing) return;

    gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(MUSIC_VOLUME, ctx.currentTime + FADE_DURATION);
    gainNode.connect(master);

    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gainNode);
    source.start();

    playing = true;

    source.onended = () => {
      playing = false;
      source = null;
      gainNode = null;
    };
  } catch (error) {
    console.warn("Lobby music could not be started.", error);
  } finally {
    starting = false;
  }
}

export function stopLobbyMusic() {
  startToken += 1;
  starting = false;

  if (!playing || !source || !gainNode) return;

  const ctx = SoundEngine.getContext();
  const now = ctx.currentTime;

  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(0, now + FADE_DURATION);

  const currentSource = source;
  setTimeout(() => {
    try {
      currentSource.stop();
    } catch {
      /* already stopped */
    }
  }, FADE_DURATION * 1000 + 50);

  playing = false;
  source = null;
  gainNode = null;
}

export function isLobbyMusicPlaying() {
  return playing;
}

import { SoundEngine } from "./sound-engine";

const MUSIC_PATH = "/audio/lobby-music.mp3";
const MUSIC_VOLUME = 0.3;
const FADE_DURATION = 1;

let audioBuffer: AudioBuffer | null = null;
let source: AudioBufferSourceNode | null = null;
let gainNode: GainNode | null = null;
let loading = false;
let playing = false;

async function loadBuffer(): Promise<AudioBuffer> {
  if (audioBuffer) return audioBuffer;
  if (loading) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (audioBuffer) {
          clearInterval(check);
          resolve(audioBuffer);
        }
      }, 100);
    });
  }

  loading = true;
  const ctx = SoundEngine.getContext();
  const response = await fetch(MUSIC_PATH);
  const arrayBuffer = await response.arrayBuffer();
  audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  loading = false;
  return audioBuffer;
}

export async function startLobbyMusic() {
  if (playing) return;

  const buffer = await loadBuffer();
  const ctx = SoundEngine.getContext();
  const master = SoundEngine.getMasterGain();

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
}

export function stopLobbyMusic() {
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

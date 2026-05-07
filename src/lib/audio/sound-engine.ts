const STORAGE_KEY = "draw-battle:sound-muted";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  muted = window.localStorage.getItem(STORAGE_KEY) === "1";
}

function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(ctx.destination);
  }

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  return ctx;
}

function getMasterGain(): GainNode {
  getContext();
  return masterGain!;
}

export const SoundEngine = {
  getContext,
  getMasterGain,

  mute() {
    muted = true;
    if (masterGain) masterGain.gain.value = 0;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    emitMutedChange();
  },

  unmute() {
    muted = false;
    if (masterGain) masterGain.gain.value = 1;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "0");
    }
    emitMutedChange();
  },

  toggle() {
    if (muted) {
      SoundEngine.unmute();
    } else {
      SoundEngine.mute();
    }
    return !muted;
  },

  isMuted() {
    return muted;
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

function emitMutedChange() {
  listeners.forEach((listener) => {
    listener();
  });
}

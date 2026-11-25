"use client";
/** Small synthesized sound effects (Web Audio, no files). Muted state is kept in localStorage. */
let ctx: AudioContext | null = null;
const KEY = "gtw-muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function setMuted(m: boolean) {
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event("gtw-mute"));
}

/** Must run inside a click (mobile autoplay rules): the "ready" button calls it. */
export function unlockAudio() {
  ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === "suspended") void ctx.resume();
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start(0);
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export type Sfx = "correct" | "wrong" | "tick" | "timeup" | "reveal";

export function play(s: Sfx) {
  if (isMuted()) return;
  if (!ctx) {
    try {
      unlockAudio();
    } catch {
      return;
    }
  }
  const notes: Record<Sfx, [number, number, number, OscillatorType, number][]> = {
    correct: [[660, 0, 0.18, "sine", 0.12], [990, 0.09, 0.28, "sine", 0.1]],
    wrong: [[150, 0, 0.16, "triangle", 0.14]],
    tick: [[1250, 0, 0.04, "square", 0.025]],
    timeup: [[440, 0, 0.2, "sine", 0.08], [330, 0.16, 0.32, "sine", 0.08]],
    reveal: [[523, 0, 0.5, "sine", 0.05], [784, 0, 0.6, "sine", 0.04]],
  };
  for (const n of notes[s]) tone(...n);
}

// Procedurally synthesized WebAudio SFX (SDD §6) — no asset files, unlocked
// on the first user gesture.

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  document.removeEventListener('pointerdown', initAudio);
}

document.addEventListener('pointerdown', initAudio);

function burst({ freq, q = 6, dur = 0.05, gain = 0.5, type = 'bandpass', detune = 0, delay = 0 }) {
  if (!ctx || ctx.state === 'suspended') { ctx?.resume(); if (!ctx) return; }
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq * (1 + detune);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function thump({ freq = 160, dur = 0.08, gain = 0.4, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const pitchWobble = () => (Math.random() - 0.5) * 0.1; // ±5%

export function playEvent(e) {
  if (!ctx) return;
  if (e.type === 'ball') {
    const v = Math.min((e.speed || 1) / 5, 1);
    burst({ freq: 2900, q: 9, dur: 0.028 + v * 0.02, gain: 0.15 + v * 0.75, detune: pitchWobble() });
    if (v > 0.35) thump({ freq: 190, dur: 0.05, gain: v * 0.3 });
  } else if (e.type === 'rail') {
    const v = Math.min((e.speed || 1) / 4, 1);
    burst({ freq: 420, q: 2, dur: 0.06, gain: 0.1 + v * 0.4, type: 'lowpass' });
  } else if (e.type === 'pocket') {
    burst({ freq: 1400, q: 3, dur: 0.05, gain: 0.5, detune: pitchWobble() });
    thump({ freq: 130, dur: 0.16, gain: 0.55, delay: 0.07 });
    burst({ freq: 500, q: 2, dur: 0.12, gain: 0.3, type: 'lowpass', delay: 0.08 });
  }
}

export function playCueStrike(power = 0.5) {
  burst({ freq: 2100, q: 7, dur: 0.03, gain: 0.2 + power * 0.5, detune: pitchWobble() });
}

export function playChalk() {
  burst({ freq: 3600, q: 1.5, dur: 0.09, gain: 0.12 });
}

export function playWin() {
  thump({ freq: 392, dur: 0.25, gain: 0.3 });
  thump({ freq: 523, dur: 0.3, gain: 0.3, delay: 0.16 });
  thump({ freq: 659, dur: 0.4, gain: 0.3, delay: 0.32 });
}

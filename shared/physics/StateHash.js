// Determinism plumbing: 1e-7 grid quantization and FNV-1a hashing over the
// float64 bit patterns of quantized state. Both are exact IEEE-754 operations,
// identical across JS engines.

const view = new DataView(new ArrayBuffer(8));

export function q(x) {
  // Exact on the 1e-7 grid; ±0 normalized so hashes never split on -0.
  const v = Math.round(x * 1e7) / 1e7;
  return v === 0 ? 0 : v;
}

export function mix(h, u32) {
  return Math.imul(h ^ u32, 16777619) >>> 0;
}

export function mixFloat(h, x) {
  view.setFloat64(0, x);
  return mix(mix(h, view.getUint32(0)), view.getUint32(4));
}

export const FNV_SEED = 0x811c9dc5;

export function hashBalls(balls) {
  let h = FNV_SEED >>> 0;
  for (const b of balls) {
    h = mix(h, b.id);
    h = mix(h, b.state);
    h = mixFloat(h, b.x);
    h = mixFloat(h, b.y);
    h = mixFloat(h, b.vx);
    h = mixFloat(h, b.vy);
    h = mixFloat(h, b.wx);
    h = mixFloat(h, b.wy);
    h = mixFloat(h, b.wz);
  }
  return h >>> 0;
}

// Seed for break jitter: hash of the strike input itself, so breaks vary by
// shot but replay bit-identically.
export function hashInput(input) {
  let h = FNV_SEED >>> 0;
  h = mixFloat(h, input.dir.dx);
  h = mixFloat(h, input.dir.dy);
  h = mix(h, input.power >>> 0);
  h = mix(h, (input.tip.ox + 128) >>> 0);
  h = mix(h, (input.tip.oy + 128) >>> 0);
  if (input.place) {
    h = mixFloat(h, input.place.x);
    h = mixFloat(h, input.place.y);
  }
  return h >>> 0;
}

// Tiny deterministic PRNG for seeded jitter (integer ops only).
export function xorshift32(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296; // [0, 1)
  };
}

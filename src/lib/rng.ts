/**
 * Deterministic pseudo-random number generation.
 *
 * The original build called `Math.random()` inside the signal generator and
 * inside the spectrogram paint loop, so the same scenario produced a different
 * recording on every render and the spectrogram shimmered on re-paint. Every
 * random draw now comes from a seeded generator, which means a (scenario, seed)
 * pair always reproduces the same recording.
 */

/** mulberry32 — small, fast, good enough statistical quality for signal noise. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform noise in [-1, 1). */
export function uniform(rng: () => number): number {
  return rng() * 2 - 1;
}

/** Standard normal deviate via Box–Muller. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Fill an array with unit-variance Gaussian white noise. */
export function whiteNoise(n: number, rng: () => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = gaussian(rng);
  return out;
}

/**
 * Pink (1/f) noise using Paul Kellett's economy filter.
 * Real EEG has a 1/f background; white noise alone makes the PSD look flat and
 * synthetic, which is what made the original spectrum chart unconvincing.
 */
export function pinkNoise(n: number, rng: () => number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = uniform(rng);
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848;
  }
  return out;
}

/** Deterministically derive a child seed, so each channel gets its own stream. */
export function deriveSeed(seed: number, ...parts: (string | number)[]): number {
  let h = seed >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0) || 1;
    }
    h = (h ^ 0x9e3779b9) >>> 0;
  }
  return h >>> 0;
}

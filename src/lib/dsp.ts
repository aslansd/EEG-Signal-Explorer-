/**
 * Digital signal processing primitives.
 *
 * Everything the UI labels as "computed" is computed here. Nothing in this file
 * consults a lookup table or a scenario name — it only sees numbers.
 */

export type BandName = "delta" | "theta" | "alpha" | "beta" | "gamma";

export const EEG_BANDS: Record<BandName, [number, number]> = {
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 12],
  beta: [12, 30],
  gamma: [30, 50],
};

export const BAND_ORDER: BandName[] = ["delta", "theta", "alpha", "beta", "gamma"];

// ---------------------------------------------------------------------------
// Basic statistics
// ---------------------------------------------------------------------------

export function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
}

export function variance(x: ArrayLike<number>): number {
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - m;
    s += d * d;
  }
  return x.length > 1 ? s / (x.length - 1) : 0;
}

export function rms(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return x.length ? Math.sqrt(s / x.length) : 0;
}

export function stdDev(x: ArrayLike<number>): number {
  return Math.sqrt(variance(x));
}

/** Median absolute deviation, scaled to be a robust sigma estimate. */
export function robustSigma(x: ArrayLike<number>): number {
  const med = median(x);
  const dev = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) dev[i] = Math.abs(x[i] - med);
  return 1.4826 * median(dev);
}

export function median(x: ArrayLike<number>): number {
  if (!x.length) return 0;
  const sorted = Float64Array.from(x as ArrayLike<number>).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Pearson correlation. Returns 0 when either input is constant. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT.
 * `re` and `im` must be the same power-of-two length.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  if (!isPowerOfTwo(n)) throw new Error(`fft: length ${n} is not a power of two`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let base = 0; base < n; base += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const i0 = base + k;
        const i1 = i0 + half;
        const xr = re[i1] * cr - im[i1] * ci;
        const xi = re[i1] * ci + im[i1] * cr;
        re[i1] = re[i0] - xr;
        im[i1] = im[i0] - xi;
        re[i0] += xr;
        im[i0] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Windows and Welch PSD
// ---------------------------------------------------------------------------

/** Periodic Hann window. */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

export interface Psd {
  /** Bin centre frequencies in Hz, length nfft/2 + 1. */
  freqs: Float64Array;
  /** One-sided power spectral density in µV²/Hz. */
  power: Float64Array;
  /** Frequency resolution in Hz. */
  resolution: number;
  /** Number of averaged segments. */
  segments: number;
}

/**
 * Welch's method: mean of modified periodograms over overlapping Hann-windowed,
 * mean-detrended segments. Correctly normalised so the result is a density in
 * µV²/Hz — integrating it over a band gives band power in µV².
 */
export function welchPsd(
  x: ArrayLike<number>,
  fs: number,
  nfft = 256,
  overlap = 0.5,
): Psd {
  const n = x.length;
  const size = isPowerOfTwo(nfft) ? nfft : nextPowerOfTwo(nfft);
  const half = size >> 1;
  const freqs = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) freqs[k] = (k * fs) / size;

  const power = new Float64Array(half + 1);
  if (n < size) {
    return { freqs, power, resolution: fs / size, segments: 0 };
  }

  const win = hannWindow(size);
  let winPowerSum = 0;
  for (let i = 0; i < size; i++) winPowerSum += win[i] * win[i];
  // Density normalisation (matches scipy.signal.welch with scaling="density").
  const scale = 1 / (fs * winPowerSum);

  const step = Math.max(1, size - Math.floor(size * overlap));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let segments = 0;

  for (let start = 0; start + size <= n; start += step) {
    let segMean = 0;
    for (let i = 0; i < size; i++) segMean += x[start + i];
    segMean /= size;

    for (let i = 0; i < size; i++) {
      re[i] = (x[start + i] - segMean) * win[i];
      im[i] = 0;
    }
    fft(re, im);

    for (let k = 0; k <= half; k++) {
      const mag2 = re[k] * re[k] + im[k] * im[k];
      // Double all bins except DC and Nyquist to fold negative frequencies in.
      const fold = k === 0 || k === half ? 1 : 2;
      power[k] += mag2 * scale * fold;
    }
    segments++;
  }

  if (segments > 0) {
    for (let k = 0; k <= half; k++) power[k] /= segments;
  }
  return { freqs, power, resolution: fs / size, segments };
}

/**
 * Integrate a PSD over [lo, hi] with the trapezoid rule → absolute power in µV².
 * The band is clipped to the available frequency range, so asking for gamma on a
 * 64 Hz recording returns the part that actually exists instead of nonsense.
 */
export function bandPower(psd: Psd, lo: number, hi: number): number {
  const { freqs, power } = psd;
  if (freqs.length < 2) return 0;
  const fMax = freqs[freqs.length - 1];
  const a = Math.max(freqs[0], Math.min(lo, fMax));
  const b = Math.max(freqs[0], Math.min(hi, fMax));
  if (b <= a) return 0;

  let total = 0;
  for (let k = 0; k < freqs.length - 1; k++) {
    const f0 = freqs[k];
    const f1 = freqs[k + 1];
    if (f1 <= a || f0 >= b) continue;
    // Clip the trapezoid to the band edges and interpolate the endpoints.
    const left = Math.max(f0, a);
    const right = Math.min(f1, b);
    const t0 = (left - f0) / (f1 - f0);
    const t1 = (right - f0) / (f1 - f0);
    const p0 = power[k] + (power[k + 1] - power[k]) * t0;
    const p1 = power[k] + (power[k + 1] - power[k]) * t1;
    total += ((p0 + p1) / 2) * (right - left);
  }
  return total;
}

/** All five classical bands at once, in µV². */
export function bandPowers(psd: Psd): Record<BandName, number> {
  const out = {} as Record<BandName, number>;
  for (const band of BAND_ORDER) {
    const [lo, hi] = EEG_BANDS[band];
    out[band] = bandPower(psd, lo, hi);
  }
  return out;
}

// ---------------------------------------------------------------------------
// IIR filters
// ---------------------------------------------------------------------------

/** Normalised biquad section (a0 divided out). */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function normalise(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** RBJ cookbook notch (band-stop) at f0 with quality factor q. */
export function notchSection(fs: number, f0: number, q = 30): Biquad {
  const w0 = (2 * Math.PI * f0) / fs;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  return normalise(1, -2 * cw, 1, 1 + alpha, -2 * cw, 1 - alpha);
}

function lowpassSection(fs: number, fc: number, q: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const k = (1 - cw) / 2;
  return normalise(k, 1 - cw, k, 1 + alpha, -2 * cw, 1 - alpha);
}

function highpassSection(fs: number, fc: number, q: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const k = (1 + cw) / 2;
  return normalise(k, -(1 + cw), k, 1 + alpha, -2 * cw, 1 - alpha);
}

/**
 * Butterworth Q factors for an even-order cascade.
 * Order 2 → [0.7071]; order 4 → [1.3066, 0.5412]; order 6 → [1.9319, 0.7071, 0.5177].
 */
export function butterworthQs(order: number): number[] {
  const n = Math.max(2, order % 2 === 0 ? order : order + 1);
  const qs: number[] = [];
  for (let k = 0; k < n / 2; k++) {
    qs.push(1 / (2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * n))));
  }
  return qs;
}

export function butterworthLowpass(fs: number, fc: number, order = 4): Biquad[] {
  const nyq = fs / 2;
  const f = Math.min(Math.max(fc, 0.01), nyq * 0.99);
  return butterworthQs(order).map((q) => lowpassSection(fs, f, q));
}

export function butterworthHighpass(fs: number, fc: number, order = 4): Biquad[] {
  const nyq = fs / 2;
  const f = Math.min(Math.max(fc, 0.01), nyq * 0.99);
  return butterworthQs(order).map((q) => highpassSection(fs, f, q));
}

/** Single forward pass of a biquad cascade (causal, introduces phase lag). */
export function applySections(x: ArrayLike<number>, sections: Biquad[]): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i];
  for (const s of sections) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const xn = out[i];
      const yn = s.b0 * xn + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      x2 = x1;
      x1 = xn;
      y2 = y1;
      y1 = yn;
      out[i] = yn;
    }
  }
  return out;
}

function reverse(x: Float32Array): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[n - 1 - i];
  return out;
}

/**
 * Zero-phase filtering: forward pass, reverse, forward pass, reverse — the same
 * idea as scipy's `filtfilt` and MNE's default. Edges are handled with odd
 * reflection padding so the filter does not ring at the start of the recording.
 *
 * Note the magnitude response is squared by the double pass, so a 4th-order
 * design attenuates like an 8th-order one. That is expected and is why the UI
 * describes these as zero-phase rather than quoting a single order.
 */
export function filtfilt(x: ArrayLike<number>, sections: Biquad[]): Float32Array {
  const n = x.length;
  if (n === 0 || sections.length === 0) return Float32Array.from(x as ArrayLike<number>);

  const pad = Math.min(n - 1, Math.max(16, sections.length * 24));
  const padded = new Float32Array(n + 2 * pad);
  // Odd (antisymmetric) reflection about the endpoints.
  for (let i = 0; i < pad; i++) {
    padded[i] = 2 * x[0] - x[pad - i];
    padded[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i];
  }
  for (let i = 0; i < n; i++) padded[pad + i] = x[i];

  const forward = applySections(padded, sections);
  const backward = reverse(applySections(reverse(forward), sections));

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = backward[pad + i];
  return out;
}

/** Zero-phase notch, plus harmonics that still fit below Nyquist. */
export function notchFilter(
  x: ArrayLike<number>,
  fs: number,
  f0: number,
  q = 30,
  harmonics = 2,
): Float32Array {
  const nyq = fs / 2;
  const sections: Biquad[] = [];
  for (let h = 1; h <= harmonics; h++) {
    const f = f0 * h;
    if (f < nyq * 0.95) sections.push(notchSection(fs, f, q));
  }
  if (!sections.length) return Float32Array.from(x as ArrayLike<number>);
  return filtfilt(x, sections);
}

/** Zero-phase bandpass built from a highpass and a lowpass cascade. */
export function bandpassFilter(
  x: ArrayLike<number>,
  fs: number,
  lo: number,
  hi: number,
  order = 4,
): Float32Array {
  const nyq = fs / 2;
  const low = Math.max(0.05, Math.min(lo, nyq * 0.9));
  const high = Math.max(low + 0.5, Math.min(hi, nyq * 0.98));
  let out = filtfilt(x, butterworthHighpass(fs, low, order));
  out = filtfilt(out, butterworthLowpass(fs, high, order));
  return out;
}

/** Convenience: keep only energy above `fc`. Used for noise-floor estimation. */
export function highpassFilter(
  x: ArrayLike<number>,
  fs: number,
  fc: number,
  order = 4,
): Float32Array {
  return filtfilt(x, butterworthHighpass(fs, fc, order));
}

// ---------------------------------------------------------------------------
// Short-time Fourier transform (for the spectrogram)
// ---------------------------------------------------------------------------

export interface Stft {
  /** Frame centre times in seconds. */
  times: Float64Array;
  /** Bin centre frequencies in Hz. */
  freqs: Float64Array;
  /**
   * Power in dB (10·log10 µV²/Hz), laid out row-major as
   * `db[frameIndex * freqs.length + freqIndex]`.
   */
  db: Float32Array;
  minDb: number;
  maxDb: number;
}

/**
 * Sliding-window spectrogram of one channel. This replaces the previous
 * implementation, which drew a picture from the segment *label* rather than from
 * the signal — meaning it ignored the selected channel entirely and could not
 * respond to filtering.
 */
export function stft(
  x: ArrayLike<number>,
  fs: number,
  nfft = 256,
  hop = 32,
  maxFreq = 45,
): Stft {
  const size = isPowerOfTwo(nfft) ? nfft : nextPowerOfTwo(nfft);
  const half = size >> 1;
  const nBinsAll = half + 1;
  const binHz = fs / size;
  const nBins = Math.min(nBinsAll, Math.floor(maxFreq / binHz) + 1);

  const freqs = new Float64Array(nBins);
  for (let k = 0; k < nBins; k++) freqs[k] = k * binHz;

  const n = x.length;
  const frameCount = n >= size ? Math.floor((n - size) / hop) + 1 : 0;
  const times = new Float64Array(Math.max(frameCount, 0));
  const db = new Float32Array(Math.max(frameCount, 0) * nBins);

  if (frameCount === 0) {
    return { times, freqs, db, minDb: 0, maxDb: 1 };
  }

  const win = hannWindow(size);
  let winPowerSum = 0;
  for (let i = 0; i < size; i++) winPowerSum += win[i] * win[i];
  const scale = 1 / (fs * winPowerSum);

  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let minDb = Infinity;
  let maxDb = -Infinity;
  const floor = 1e-6;

  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    times[f] = (start + size / 2) / fs;

    let segMean = 0;
    for (let i = 0; i < size; i++) segMean += x[start + i];
    segMean /= size;

    for (let i = 0; i < size; i++) {
      re[i] = (x[start + i] - segMean) * win[i];
      im[i] = 0;
    }
    fft(re, im);

    for (let k = 0; k < nBins; k++) {
      const mag2 = re[k] * re[k] + im[k] * im[k];
      const fold = k === 0 || k === half ? 1 : 2;
      const value = 10 * Math.log10(mag2 * scale * fold + floor);
      db[f * nBins + k] = value;
      if (value < minDb) minDb = value;
      if (value > maxDb) maxDb = value;
    }
  }

  return { times, freqs, db, minDb, maxDb };
}

// ---------------------------------------------------------------------------
// Misc helpers used by the pipeline
// ---------------------------------------------------------------------------

/** Subtract the mean in place-style (returns a new array). */
export function removeMean(x: ArrayLike<number>): Float32Array {
  const m = mean(x);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - m;
  return out;
}

/**
 * Dominant period of a signal via normalised autocorrelation, searched inside
 * [minLag, maxLag] samples. Returns null when no clear peak stands out.
 * Used to measure heart rate from ECG contamination instead of hard-coding it.
 */
export function dominantPeriod(
  x: ArrayLike<number>,
  minLag: number,
  maxLag: number,
): { lag: number; strength: number } | null {
  const n = x.length;
  const hi = Math.min(maxLag, n - 1);
  if (minLag < 1 || hi <= minLag) return null;

  const m = mean(x);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - m;
    energy += d * d;
  }
  if (energy <= 0) return null;

  let bestLag = -1;
  let bestValue = -Infinity;
  for (let lag = minLag; lag <= hi; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += (x[i] - m) * (x[i + lag] - m);
    const norm = acc / energy;
    if (norm > bestValue) {
      bestValue = norm;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestValue <= 0.05) return null;
  return { lag: bestLag, strength: bestValue };
}

export interface PeakTrain {
  /** Sample indices of accepted peaks. */
  peaks: number[];
  /** Median inter-peak interval in samples. */
  medianInterval: number;
  /** Coefficient of variation of the intervals — low means a regular rhythm. */
  intervalCv: number;
}

/**
 * Find a regular train of sharp peaks.
 *
 * Autocorrelation alone was unreliable here: on EEG the cortical rhythms
 * dominate the correlogram and the search kept locking onto the shortest
 * permitted lag, so measured heart rates came out at 194 bpm against a true 81.
 * Thresholded peak picking with a refractory period, scored by interval
 * regularity, recovers the rate directly.
 */
export function detectPeakTrain(
  x: ArrayLike<number>,
  fs: number,
  minBpm = 40,
  maxBpm = 180,
  sensitivity = 3,
): PeakTrain | null {
  const n = x.length;
  if (n < fs * 3) return null;

  // `x` is expected to be a non-negative detection function (see
  // `qrsDetectionFunction` for how one is built). Only light smoothing is applied
  // here so callers stay in control of the emphasis stage.
  const smooth = movingAverage(x, Math.max(3, Math.round(0.02 * fs)));

  const base = median(smooth);
  const sigma = robustSigma(smooth) || stdDev(smooth) || 1;
  const threshold = base + sensitivity * sigma;
  const refractory = Math.max(2, Math.round((fs * 60) / maxBpm));

  const peaks: number[] = [];
  let i = 1;
  while (i < n - 1) {
    if (smooth[i] < threshold) {
      i++;
      continue;
    }
    // Take the maximum of this above-threshold run.
    let bestIdx = i;
    let bestVal = smooth[i];
    let j = i;
    while (j < n && smooth[j] >= threshold) {
      if (smooth[j] > bestVal) {
        bestVal = smooth[j];
        bestIdx = j;
      }
      j++;
    }
    if (!peaks.length || bestIdx - peaks[peaks.length - 1] >= refractory) {
      peaks.push(bestIdx);
    } else if (bestVal > smooth[peaks[peaks.length - 1]]) {
      peaks[peaks.length - 1] = bestIdx;
    }
    i = j;
  }

  if (peaks.length < 5) return null;

  const intervals: number[] = [];
  for (let k = 1; k < peaks.length; k++) intervals.push(peaks[k] - peaks[k - 1]);
  const medianInterval = median(intervals);
  if (medianInterval <= 0) return null;

  const bpm = (60 * fs) / medianInterval;
  if (bpm < minBpm || bpm > maxBpm) return null;

  const m = mean(intervals);
  const sd = stdDev(intervals);
  const intervalCv = m > 0 ? sd / m : 1;

  return { peaks, medianInterval, intervalCv };
}

/**
 * Pan–Tompkins style detection function for sharp, fast transients.
 *
 * Band-limiting alone was not enough to find the cardiac beat: continuous beta
 * activity sits in the same band and kept the median energy high enough that the
 * QRS never crossed threshold. Differentiating first emphasises the steep QRS
 * slope over any smooth rhythm of comparable amplitude, and the moving-window
 * integration afterwards turns each complex into a single broad hump.
 */
export function qrsDetectionFunction(
  x: ArrayLike<number>,
  fs: number,
  integrationSeconds = 0.08,
): Float32Array {
  const n = x.length;
  const derivative = new Float32Array(n);
  for (let i = 1; i < n; i++) derivative[i] = x[i] - x[i - 1];
  if (n > 1) derivative[0] = derivative[1];

  const squared = new Float32Array(n);
  for (let i = 0; i < n; i++) squared[i] = derivative[i] * derivative[i];

  return movingAverage(squared, Math.max(3, Math.round(integrationSeconds * fs)));
}

/** Zero any run of set samples shorter than `minSamples`. */
export function requireMinRun(mask: Uint8Array, minSamples: number): Uint8Array {
  const n = mask.length;
  const out = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    if (!mask[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && mask[j]) j++;
    if (j - i >= minSamples) {
      for (let k = i; k < j; k++) out[k] = 1;
    }
    i = j;
  }
  return out;
}

/** Moving-average smoothing with a centred window; used for envelopes. */
export function movingAverage(x: ArrayLike<number>, width: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const w = Math.max(1, Math.floor(width));
  if (w === 1) {
    for (let i = 0; i < n; i++) out[i] = x[i];
    return out;
  }
  const half = w >> 1;
  let acc = 0;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    acc += x[i];
    prefix[i + 1] = acc;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

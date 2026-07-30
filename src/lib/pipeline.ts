/**
 * The processing pipeline.
 *
 * Every number the dashboard shows comes out of this file, measured from the
 * signal. Previously the band powers, heart rate, noise floor and artifact ratio
 * were constants in a lookup table, which meant changing the filter settings
 * could not possibly alter any chart — the controls were decorative.
 */

import { MONTAGE, nearestSites } from "../data/presets";
import type {
  ArtifactMasks,
  BandPowerRow,
  EegRecording,
  PipelineConfig,
  ProcessedRecording,
  SignalMetrics,
} from "../types";
import { classifyEpochs } from "./classify";
import {
  BAND_ORDER,
  bandPowers,
  bandpassFilter,
  clamp,
  correlation,
  detectPeakTrain,
  highpassFilter,
  qrsDetectionFunction,
  mean,
  median,
  movingAverage,
  notchFilter,
  requireMinRun,
  robustSigma,
  rms,
  stdDev,
  variance,
  welchPsd,
  nextPowerOfTwo,
} from "./dsp";
import type { PeakTrain, Psd } from "./dsp";

type Signals = Record<string, Float32Array>;

function copySignals(src: Signals, channels: string[]): Signals {
  const out: Signals = {};
  for (const ch of channels) out[ch] = Float32Array.from(src[ch]);
  return out;
}

// ---------------------------------------------------------------------------
// Preprocessing
// ---------------------------------------------------------------------------

function reReference(
  signals: Signals,
  channels: string[],
  mode: PipelineConfig["preprocessing"]["reReferencing"],
  log: string[],
): Signals {
  if (mode === "none" || channels.length < 2) {
    log.push("Reference: left as recorded.");
    return signals;
  }

  const n = signals[channels[0]].length;

  if (mode === "average") {
    const out: Signals = {};
    const refTrace = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (const ch of channels) acc += signals[ch][i];
      refTrace[i] = acc / channels.length;
    }
    for (const ch of channels) {
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = signals[ch][i] - refTrace[i];
      out[ch] = s;
    }
    log.push(`Reference: common average across ${channels.length} electrodes.`);
    return out;
  }

  // Linked mastoid: approximate with the mean of the two most lateral sites,
  // which is the closest thing available when A1/A2 were not recorded.
  const lateral = [...channels]
    .filter((ch) => MONTAGE[ch])
    .sort((a, b) => Math.abs(MONTAGE[b].x) - Math.abs(MONTAGE[a].x))
    .slice(0, 2);
  if (lateral.length < 2) {
    log.push("Reference: linked mastoid unavailable, left as recorded.");
    return signals;
  }
  const out: Signals = {};
  for (const ch of channels) {
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ref = (signals[lateral[0]][i] + signals[lateral[1]][i]) / 2;
      s[i] = signals[ch][i] - ref;
    }
    out[ch] = s;
  }
  log.push(`Reference: linked mastoid approximated from ${lateral.join(" + ")}.`);
  return out;
}

function applyPreprocessing(
  recording: EegRecording,
  config: PipelineConfig,
  log: string[],
): Signals {
  const { preprocessing } = config;
  const fs = recording.sampleRate;
  const nyquist = fs / 2;
  let signals = copySignals(recording.raw, recording.channels);

  if (preprocessing.notchFilter) {
    if (preprocessing.notchFrequency >= nyquist) {
      log.push(
        `Notch skipped: ${preprocessing.notchFrequency} Hz is at or above the ${nyquist} Hz Nyquist limit.`,
      );
    } else {
      for (const ch of recording.channels) {
        signals[ch] = notchFilter(signals[ch], fs, preprocessing.notchFrequency, preprocessing.notchQ, 2);
      }
      const harmonic = preprocessing.notchFrequency * 2 < nyquist * 0.95;
      log.push(
        `Notch: zero-phase ${preprocessing.notchFrequency} Hz (Q=${preprocessing.notchQ})${harmonic ? " plus first harmonic" : ""}.`,
      );
    }
  }

  if (preprocessing.bandpassEnabled) {
    const lo = clamp(preprocessing.bandpassMin, 0.05, nyquist * 0.9);
    const hi = clamp(preprocessing.bandpassMax, lo + 0.5, nyquist * 0.98);
    if (hi !== preprocessing.bandpassMax || lo !== preprocessing.bandpassMin) {
      log.push(
        `Bandpass edges clamped to ${lo.toFixed(2)}–${hi.toFixed(2)} Hz to stay inside 0–${nyquist} Hz.`,
      );
    }
    for (const ch of recording.channels) {
      signals[ch] = bandpassFilter(signals[ch], fs, lo, hi, preprocessing.filterOrder);
    }
    log.push(
      `Bandpass: zero-phase Butterworth order ${preprocessing.filterOrder}, ${lo.toFixed(2)}–${hi.toFixed(2)} Hz.`,
    );
  } else {
    log.push("Bandpass: bypassed.");
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Artifact detection and removal
// ---------------------------------------------------------------------------

/** Expand a boolean mask by `pad` samples on both sides. */
function dilate(mask: Uint8Array, pad: number): Uint8Array {
  const n = mask.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const a = Math.max(0, i - pad);
    const b = Math.min(n - 1, i + pad);
    for (let j = a; j <= b; j++) out[j] = 1;
  }
  return out;
}

/**
 * Detect and repair unusable electrodes.
 *
 * A channel is flagged when its variance is far from the group median in either
 * direction: near-zero means a disconnected lead, very large means a loose one or
 * a saturating amplifier. Flagged channels are replaced by an inverse-distance
 * weighted average of their nearest neighbours on the montage.
 */
function repairBadChannels(
  signals: Signals,
  channels: string[],
  threshold: number,
  log: string[],
): { signals: Signals; bad: string[] } {
  if (channels.length < 4) return { signals, bad: [] };

  const variances = channels.map((ch) => variance(signals[ch]));
  const medVar = median(variances) || 1;
  const bad: string[] = [];

  channels.forEach((ch, idx) => {
    const ratio = variances[idx] / medVar;
    // The threshold slider widens or narrows the acceptance band.
    const upper = 1 + threshold * 1.6;
    if (ratio > upper || ratio < 0.08) bad.push(ch);
  });

  if (!bad.length) {
    log.push("Bad channels: none flagged.");
    return { signals, bad };
  }

  const good = channels.filter((ch) => !bad.includes(ch));
  if (!good.length) {
    log.push("Bad channels: every channel flagged, repair skipped.");
    return { signals, bad };
  }

  const out: Signals = { ...signals };
  const n = signals[channels[0]].length;
  for (const ch of bad) {
    const neighbours = nearestSites(ch, good, 3);
    const donors = neighbours.length ? neighbours : good.slice(0, 3);
    const weights = donors.map((d) => {
      const p = MONTAGE[ch];
      const q = MONTAGE[d];
      if (!p || !q) return 1;
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      return 1 / Math.max(dist, 1e-3) ** 2;
    });
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    const repaired = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let d = 0; d < donors.length; d++) acc += signals[donors[d]][i] * weights[d];
      repaired[i] = acc / wSum;
    }
    out[ch] = repaired;
    log.push(`Bad channel ${ch}: interpolated from ${donors.join(", ")}.`);
  }
  return { signals: out, bad };
}

/**
 * Ocular artifact removal by regression.
 *
 * The frontopolar mean serves as an EOG surrogate; for each channel the least
 * squares coefficient onto that surrogate is removed. This is a standard method
 * that can be stated honestly, unlike the previous UI which offered
 * "autoencoder", "transformer" and "1D-Conv" options that were not implemented
 * and had no effect on the data at all.
 */
function removeOcular(
  signals: Signals,
  channels: string[],
  fs: number,
  threshold: number,
  log: string[],
): { signals: Signals; mask: Uint8Array; blinkCount: number } {
  const n = signals[channels[0]].length;
  const anterior = channels.filter((ch) => ch.startsWith("Fp"));
  const frontal = anterior.length ? anterior : channels.filter((ch) => ch.startsWith("F"));
  const posterior = channels.filter((ch) => ch.startsWith("O") || ch.startsWith("P"));

  if (!frontal.length) {
    log.push("Ocular: no frontal channel available, skipped.");
    return { signals, mask: new Uint8Array(n), blinkCount: 0 };
  }

  /**
   * Frontal minus posterior, not frontal alone.
   *
   * A plain frontal average contains as much cortical delta as ocular activity,
   * so during slow-wave sleep the detector fired on genuine brain signal and the
   * regression then subtracted it — which is why cleaning previously made the
   * correlation with ground truth worse. Subtracting a posterior reference keeps
   * the frontally-dominant ocular component and cancels the widespread cortical
   * part.
   */
  const surrogate = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let front = 0;
    for (const ch of frontal) front += signals[ch][i];
    front /= frontal.length;
    let back = 0;
    if (posterior.length) {
      for (const ch of posterior) back += signals[ch][i];
      back /= posterior.length;
    }
    surrogate[i] = front - back;
  }

  const eogBand = bandpassFilter(surrogate, fs, 0.5, Math.min(8, fs / 2 - 1), 4);

  // Blinks are positive-going at frontopolar sites, brief, and separated by at
  // least a couple of hundred milliseconds. Detect signed peaks, not |value|.
  const base = median(eogBand);
  const sigma = robustSigma(eogBand) || stdDev(eogBand) || 1;
  /**
   * Two criteria, both required.
   *
   * A purely statistical threshold scales with whatever else is in the recording:
   * during slow-wave sleep the robust sigma is set by 40 µV delta, so ordinary
   * cortical activity crossed it and produced fifteen "blinks" against four real
   * ones. Blinks are physiologically large, so an absolute floor is also applied.
   */
  const ABSOLUTE_BLINK_FLOOR_UV = 45;
  const cut = Math.max(base + Math.max(threshold, 2) * sigma, base + ABSOLUTE_BLINK_FLOOR_UV);
  const refractory = Math.round(0.25 * fs);
  const halfWidth = Math.round(0.16 * fs);
  /**
   * A blink deflection lasts roughly 200–400 ms. An epileptiform spike lasts
   * 50–70 ms and is also frontally dominant, so without a width requirement the
   * detector treated every discharge in the epilepsy preset as a blink and the
   * regression then attenuated the one feature that recording exists to show.
   */
  const minWidth = Math.round(0.08 * fs);
  const maxWidth = Math.round(0.9 * fs);

  const mask = new Uint8Array(n);
  const peaks: number[] = [];
  let rejectedNarrow = 0;
  let i = 1;
  while (i < n - 1) {
    if (eogBand[i] < cut) {
      i++;
      continue;
    }
    let bestIdx = i;
    let bestVal = eogBand[i];
    let j = i;
    while (j < n && eogBand[j] >= cut) {
      if (eogBand[j] > bestVal) {
        bestVal = eogBand[j];
        bestIdx = j;
      }
      j++;
    }
    const width = j - i;
    if (width < minWidth || width > maxWidth) {
      rejectedNarrow++;
      i = j;
      continue;
    }
    if (!peaks.length || bestIdx - peaks[peaks.length - 1] >= refractory) peaks.push(bestIdx);
    i = j;
  }
  for (const p of peaks) {
    for (let k = Math.max(0, p - halfWidth); k < Math.min(n, p + halfWidth); k++) mask[k] = 1;
  }
  const blinkCount = peaks.length;

  if (!blinkCount) {
    log.push(`Ocular: nothing above ${Math.max(threshold, 2).toFixed(1)}σ, no correction applied.`);
    return { signals, mask, blinkCount: 0 };
  }

  /**
   * Regress a blink-gated copy of the surrogate, zero outside detected events.
   * Regressing the full-length surrogate would also remove ordinary frontal
   * activity everywhere in the recording, not just where a blink happened.
   */
  const regressor = new Float32Array(n);
  for (let k = 0; k < n; k++) regressor[k] = mask[k] ? eogBand[k] - base : 0;

  const rMean = mean(regressor);
  let denom = 0;
  for (let k = 0; k < n; k++) {
    const d = regressor[k] - rMean;
    denom += d * d;
  }

  const out: Signals = {};
  for (const ch of channels) {
    if (denom <= 0) {
      out[ch] = signals[ch];
      continue;
    }
    const chMean = mean(signals[ch]);
    let num = 0;
    for (let k = 0; k < n; k++) num += (signals[ch][k] - chMean) * (regressor[k] - rMean);
    const beta = num / denom;
    const cleaned = new Float32Array(n);
    for (let k = 0; k < n; k++) cleaned[k] = signals[ch][k] - beta * (regressor[k] - rMean);
    out[ch] = cleaned;
  }

  log.push(
    `Ocular: ${blinkCount} event${blinkCount === 1 ? "" : "s"} over ${Math.max(threshold, 2).toFixed(1)}σ on ${frontal.join("+")}${posterior.length ? ` minus ${posterior.join("+")}` : ""}${rejectedNarrow ? `, ${rejectedNarrow} transient${rejectedNarrow === 1 ? "" : "s"} rejected as too brief to be ocular` : ""}; regressed out within event windows only.`,
  );
  return { signals: out, mask, blinkCount };
}

/**
 * Muscle suppression.
 *
 * High-frequency power is tracked in a sliding window; where it exceeds the
 * threshold the signal is crossfaded towards a low-passed copy, so the burst is
 * attenuated without putting a discontinuity at the window edges.
 */
function suppressMuscle(
  signals: Signals,
  channels: string[],
  fs: number,
  threshold: number,
  log: string[],
): { signals: Signals; mask: Uint8Array } {
  const n = signals[channels[0]].length;
  const nyquist = fs / 2;
  const hfLow = Math.min(20, nyquist * 0.5);
  if (hfLow >= nyquist * 0.95) {
    log.push("Muscle: sample rate too low to separate a high-frequency band, skipped.");
    return { signals, mask: new Uint8Array(n) };
  }

  const combined = new Uint8Array(n);
  const out: Signals = {};
  const win = Math.max(4, Math.round(0.1 * fs));
  const minRun = Math.max(2, Math.round(0.08 * fs));

  for (const ch of channels) {
    /**
     * Flag on the ratio of high-frequency to low-frequency envelope, not on
     * high-frequency amplitude alone.
     *
     * Absolute HF amplitude also rises during epileptic spikes, which are
     * broadband — the earlier version therefore flagged nearly half of a seizure
     * as muscle and then low-passed the very feature the recording exists to
     * show. EMG is specifically HF-dominant, so the ratio separates the two.
     */
    const hf = highpassFilter(signals[ch], fs, hfLow, 4);
    const lf = bandpassFilter(signals[ch], fs, 1, Math.min(hfLow, nyquist * 0.9), 4);
    const hfEnv = movingAverage(
      Float32Array.from(hf, (v) => Math.abs(v)),
      win,
    );
    const lfEnv = movingAverage(
      Float32Array.from(lf, (v) => Math.abs(v)),
      win,
    );

    const logRatio = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      logRatio[i] = Math.log((hfEnv[i] + 1e-6) / (lfEnv[i] + 1e-6));
    }
    const centre = median(logRatio);
    const spread = robustSigma(logRatio) || stdDev(logRatio) || 1;

    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if ((logRatio[i] - centre) / spread > threshold) mask[i] = 1;
    }
    const sustained = requireMinRun(mask, minRun);
    const wide = dilate(sustained, Math.round(0.04 * fs));
    for (let i = 0; i < n; i++) if (wide[i]) combined[i] = 1;

    // Crossfade weight, smoothed so the transition is gradual.
    const weightRaw = new Float32Array(n);
    for (let i = 0; i < n; i++) weightRaw[i] = wide[i] ? 1 : 0;
    const weight = movingAverage(weightRaw, Math.max(3, Math.round(0.08 * fs)));

    const lowpassed = bandpassFilter(signals[ch], fs, 0.4, hfLow, 4);
    const cleaned = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = clamp(weight[i], 0, 1);
      cleaned[i] = signals[ch][i] * (1 - w) + lowpassed[i] * w;
    }
    out[ch] = cleaned;
  }

  let affected = 0;
  for (let i = 0; i < n; i++) if (combined[i]) affected++;
  log.push(
    `Muscle: >${hfLow.toFixed(0)} Hz bursts flagged on ${((affected / n) * 100).toFixed(1)}% of samples, band-limited in place.`,
  );
  return { signals: out, mask: combined };
}

/**
 * Cardiac template subtraction.
 *
 * The beat period is found by autocorrelating the central-site mean; beats are
 * then averaged into a template per channel and subtracted. This also gives us a
 * measured heart rate, which is what the dashboard reports instead of the
 * previous hard-coded `72 + random()`.
 */
function removeCardiac(
  signals: Signals,
  channels: string[],
  fs: number,
  log: string[],
  ecgLead?: Float32Array,
): { signals: Signals; mask: Uint8Array; bpm: number | null } {
  const n = signals[channels[0]].length;
  const central = channels.filter((ch) => ch.startsWith("C"));
  const sources = central.length ? central : channels;

  const composite = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (const ch of sources) acc += signals[ch][i];
    composite[i] = acc / sources.length;
  }

  /**
   * Try the whole-head composite and each individual channel, then keep whichever
   * gives the most regular beat train.
   *
   * A fixed composite fails on montages with no central electrodes at all (the
   * epilepsy preset has none), where the cardiac field is strongest on the
   * temporal channels and gets diluted by averaging everything together.
   */
  const candidates: { label: string; signal: Float32Array }[] = ecgLead
    ? [{ label: "ECG lead", signal: ecgLead }]
    : [
        { label: "composite", signal: composite },
        ...channels.map((ch) => ({ label: ch, signal: signals[ch] })),
      ];
  // A dedicated ECG lead needs no corroboration — it is the measurement.
  const minAgreeing = ecgLead ? 1 : 2;

  /**
   * Interval regularity separates a real beat train from a cortical one cleanly.
   * Measured on the presets, channels carrying genuine cardiac contamination come
   * back with an interval CV around 0.19–0.25, while channels picking up rhythmic
   * brain activity land at 0.6 and above.
   */
  const CARDIAC_MAX_CV = 0.35;

  const found: { label: string; train: PeakTrain; bpm: number }[] = [];
  for (const candidate of candidates) {
    const band = bandpassFilter(candidate.signal, fs, 8, Math.min(25, fs / 2 - 1), 4);
    const detection = qrsDetectionFunction(band, fs);
    // Sweep the peak-picking sensitivity: the right value depends on how much
    // cortical activity sits in the same band, which varies by state.
    let bestForChannel: PeakTrain | null = null;
    for (const sensitivity of [1.5, 2.5, 3.5]) {
      const result = detectPeakTrain(detection, fs, 40, 180, sensitivity);
      if (!result) continue;
      if (!bestForChannel || result.intervalCv < bestForChannel.intervalCv) {
        bestForChannel = result;
      }
    }
    if (!bestForChannel || bestForChannel.intervalCv > CARDIAC_MAX_CV) continue;
    found.push({
      label: candidate.label,
      train: bestForChannel,
      bpm: (60 * fs) / bestForChannel.medianInterval,
    });
  }

  /**
   * Require independent channels to agree on the rate.
   *
   * Picking the single most regular train is not safe: a 3 Hz spike-and-wave run
   * is more regular than a heartbeat, and the detector happily locked onto every
   * second discharge and reported it as 97 bpm. A genuine cardiac rhythm shows up
   * at the same rate on several electrodes at once, whereas an artefact of one
   * cortical pattern does not, so the largest agreeing cluster wins and anything
   * without corroboration is reported as not detected.
   */
  let best: { members: typeof found; bpm: number } | null = null;
  for (const seedCandidate of found) {
    const members = found.filter(
      (other) => Math.abs(other.bpm - seedCandidate.bpm) / seedCandidate.bpm < 0.08,
    );
    if (!best || members.length > best.members.length) {
      best = { members, bpm: median(members.map((m) => m.bpm)) };
    }
  }

  if (!best || best.members.length < minAgreeing) {
    log.push(
      found.length
        ? `Cardiac: ${found.length} candidate rhythm${found.length === 1 ? "" : "s"} found but fewer than ${minAgreeing} channels agreed on a rate, so no rate is reported and nothing was subtracted.`
        : "Cardiac: no regular beat train found, subtraction skipped.",
    );
    return { signals, mask: new Uint8Array(n), bpm: null };
  }

  // Use the train from the cluster member with the most detected beats.
  const chosen = best.members.reduce((a, b) => (b.train.peaks.length > a.train.peaks.length ? b : a));
  const train = chosen.train;
  const trainSource = `${best.members.length} channels agreeing (best: ${chosen.label})`;

  const bpm = Math.round(best.bpm);
  const half = Math.max(2, Math.round(Math.min(0.3, train.medianInterval / fs / 2) * fs));
  const width = half * 2;

  const mask = new Uint8Array(n);
  for (const p of train.peaks) {
    const qrsHalf = Math.max(1, Math.round(0.05 * fs));
    for (let i = Math.max(0, p - qrsHalf); i < Math.min(n, p + qrsHalf); i++) mask[i] = 1;
  }

  /**
   * Average a window around every detected beat into a template, then subtract
   * it at each beat. Aligning on the detected peaks rather than on a fixed
   * period tolerates the beat-to-beat jitter a real recording has.
   */
  const out: Signals = {};
  for (const ch of channels) {
    const template = new Float64Array(width);
    const counts = new Int32Array(width);
    for (const p of train.peaks) {
      for (let k = 0; k < width; k++) {
        const idx = p - half + k;
        if (idx < 0 || idx >= n) continue;
        template[k] += signals[ch][idx];
        counts[k]++;
      }
    }
    for (let k = 0; k < width; k++) if (counts[k]) template[k] /= counts[k];

    // Remove the template's own mean and taper its edges, so subtraction cannot
    // introduce a step at the window boundary.
    const tMean = mean(template);
    const shaped = new Float64Array(width);
    for (let k = 0; k < width; k++) {
      const u = k / (width - 1);
      const taper = 0.5 * (1 - Math.cos(2 * Math.PI * Math.min(u, 1 - u) * 2));
      shaped[k] = (template[k] - tMean) * Math.min(1, taper);
    }

    const cleaned = Float32Array.from(signals[ch]);
    for (const p of train.peaks) {
      for (let k = 0; k < width; k++) {
        const idx = p - half + k;
        if (idx < 0 || idx >= n) continue;
        cleaned[idx] -= shaped[k];
      }
    }
    out[ch] = cleaned;
  }

  log.push(
    `Cardiac: ${train.peaks.length} beats on ${trainSource}, median interval ${(train.medianInterval / fs).toFixed(3)} s (${bpm} bpm, interval CV ${train.intervalCv.toFixed(2)}); template subtracted.`,
  );
  return { signals: out, mask, bpm };
}

// ---------------------------------------------------------------------------
// Normalisation (display only)
// ---------------------------------------------------------------------------

function normaliseForDisplay(
  signals: Signals,
  channels: string[],
  mode: PipelineConfig["preprocessing"]["normalization"],
): { display: Signals; units: ProcessedRecording["displayUnits"] } {
  if (mode === "none") return { display: signals, units: "µV" };

  const display: Signals = {};
  for (const ch of channels) {
    const x = signals[ch];
    const out = new Float32Array(x.length);
    if (mode === "z_score") {
      const m = mean(x);
      const s = stdDev(x) || 1;
      for (let i = 0; i < x.length; i++) out[i] = (x[i] - m) / s;
    } else {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < x.length; i++) {
        if (x[i] < lo) lo = x[i];
        if (x[i] > hi) hi = x[i];
      }
      const span = hi - lo || 1;
      for (let i = 0; i < x.length; i++) out[i] = ((x[i] - lo) / span) * 2 - 1;
    }
    display[ch] = out;
  }
  return { display, units: mode === "z_score" ? "z" : "norm" };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runPipeline(
  recording: EegRecording,
  config: PipelineConfig,
): ProcessedRecording {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const log: string[] = [];
  const fs = recording.sampleRate;
  const channels = recording.channels;

  log.push(
    `Loaded ${channels.length} channels, ${recording.sampleCount} samples at ${fs} Hz (${recording.durationSeconds.toFixed(1)} s, Nyquist ${fs / 2} Hz).`,
  );

  let signals = applyPreprocessing(recording, config, log);

  const detected: ArtifactMasks = {
    eyeBlink: new Uint8Array(recording.sampleCount),
    muscle: new Uint8Array(recording.sampleCount),
    ecg: new Uint8Array(recording.sampleCount),
  };
  let badChannels: string[] = [];
  let blinkCount = 0;
  let heartRateBpm: number | null = null;
  const threshold = config.artifacts.artifactThreshold;

  /**
   * Step order matters, and getting it wrong is easy to miss.
   *
   * Bad-channel repair has to come before re-referencing: a common average
   * reference computed while one electrode is still contaminated spreads that
   * contamination into every other channel at 1/N amplitude. Artifact correction
   * also runs before referencing, because the common average attenuates exactly
   * the spatially-broad components (cardiac, ocular) the correction steps are
   * trying to identify.
   */
  if (config.artifacts.badChannelRepair) {
    const result = repairBadChannels(signals, channels, threshold, log);
    signals = result.signals;
    badChannels = result.bad;
  }

  if (config.artifacts.eogRegression) {
    const result = removeOcular(signals, channels, fs, threshold, log);
    signals = result.signals;
    detected.eyeBlink = result.mask;
    blinkCount = result.blinkCount;
  }

  if (config.artifacts.ecgTemplateRemoval) {
    const result = removeCardiac(signals, channels, fs, log, recording.aux?.ECG);
    signals = result.signals;
    detected.ecg = result.mask;
    heartRateBpm = result.bpm;
  }

  if (config.artifacts.muscleSuppression) {
    const result = suppressMuscle(signals, channels, fs, threshold, log);
    signals = result.signals;
    detected.muscle = result.mask;
  }

  signals = reReference(signals, channels, config.preprocessing.reReferencing, log);

  // --- Spectral features --------------------------------------------------
  const windowSamples = nextPowerOfTwo(
    Math.max(64, Math.round(config.features.windowSeconds * fs)),
  );
  const psd: Record<string, Psd> = {};
  const bandPower: BandPowerRow[] = [];

  for (const ch of channels) {
    const spectrum = welchPsd(signals[ch], fs, windowSamples, config.features.overlap);
    psd[ch] = spectrum;
    const powers = bandPowers(spectrum);
    const total = BAND_ORDER.reduce((acc, band) => acc + powers[band], 0);
    bandPower.push({
      channel: ch,
      ...powers,
      total,
      repaired: badChannels.includes(ch),
    });
  }
  const firstPsd = psd[channels[0]];
  log.push(
    `Welch PSD: ${windowSamples}-sample Hann segments, ${Math.round(config.features.overlap * 100)}% overlap, ${firstPsd?.segments ?? 0} segments averaged, ${firstPsd ? firstPsd.resolution.toFixed(3) : "?"} Hz resolution.`,
  );

  // --- Metrics ------------------------------------------------------------
  const artifactRatio = (() => {
    let hits = 0;
    for (let i = 0; i < recording.sampleCount; i++) {
      // Union rather than a sum, so overlapping artifacts are not double counted.
      if (detected.eyeBlink[i] || detected.muscle[i] || detected.ecg[i]) hits++;
    }
    return recording.sampleCount ? hits / recording.sampleCount : 0;
  })();

  const noiseFloorRms = (() => {
    const nyquist = fs / 2;
    const cutoff = Math.min(45, nyquist * 0.85);
    if (cutoff >= nyquist * 0.95) return 0;
    const values = channels.map((ch) => rms(highpassFilter(signals[ch], fs, cutoff, 4)));
    return values.length ? mean(values) : 0;
  })();

  let recoveryR: number | null = null;
  let baselineR: number | null = null;
  if (recording.reference) {
    /**
     * Score in the same reference space on both sides.
     *
     * Comparing a common-average-referenced result against un-referenced ground
     * truth made cleaning look catastrophic (r fell from 0.81 to 0.36), because
     * CAR legitimately removes the spatially broad component that most of the
     * genuine signal lives in. The ground truth has to be put through the same
     * re-referencing before the comparison means anything.
     */
    const silent: string[] = [];
    const truthReferenced = reReference(
      recording.reference,
      channels,
      config.preprocessing.reReferencing,
      silent,
    );
    const rawReferenced = reReference(
      recording.raw,
      channels,
      config.preprocessing.reReferencing,
      silent,
    );
    const cleaned: number[] = [];
    const before: number[] = [];
    for (const ch of channels) {
      cleaned.push(correlation(signals[ch], truthReferenced[ch]));
      before.push(correlation(rawReferenced[ch], truthReferenced[ch]));
    }
    recoveryR = mean(cleaned);
    baselineR = mean(before);
    const direction = recoveryR >= baselineR ? "improved" : "reduced";
    log.push(
      `Recovery: correlation with ground truth ${direction} from ${baselineR.toFixed(3)} to ${recoveryR.toFixed(3)} (same reference on both sides).`,
    );
  }

  const metrics: SignalMetrics = {
    heartRateBpm,
    blinkCount,
    noiseFloorRms,
    artifactRatio,
    recoveryR,
    baselineR,
  };

  // --- Classification -----------------------------------------------------
  const classification = config.prediction.enabled
    ? classifyEpochs(recording, signals, config)
    : null;
  if (classification) {
    const accuracyNote =
      classification.accuracy === null
        ? "no ground truth to score against"
        : `${(classification.accuracy * 100).toFixed(1)}% agreement with ground truth`;
    log.push(
      `Classifier: nearest-centroid over log band power, ${classification.epochs.length} epochs of ${config.features.epochSeconds}s, ${accuracyNote}.`,
    );
  }

  const { display, units } = normaliseForDisplay(
    signals,
    channels,
    config.preprocessing.normalization,
  );
  if (config.preprocessing.normalization !== "none") {
    log.push(
      `Normalisation: ${config.preprocessing.normalization} applied for display only — band powers above stay in µV².`,
    );
  }

  const elapsedMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;

  return {
    clean: signals,
    display,
    displayUnits: units,
    detected,
    badChannels,
    bandPower,
    psd,
    metrics,
    classification,
    log,
    elapsedMs,
  };
}

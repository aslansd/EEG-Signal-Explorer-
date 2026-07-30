/**
 * Synthetic EEG generation.
 *
 * The previous generator summed one pure sine per band, which produced a line
 * spectrum nothing like real EEG, and shaped artifacts in ways that created step
 * discontinuities in the trace. This version builds each band from band-limited
 * noise over a 1/f background and shapes every artifact as a continuous event, so
 * the output survives being measured by the DSP module rather than only looking
 * plausible at a glance.
 */

import { EEG_SCENARIOS } from "../data/presets";
import type { BandName, EegRecording, EegScenarioId, LabelSpan } from "../types";
import {
  bandpassFilter,
  clamp,
  movingAverage,
  rms,
} from "./dsp";
import { createRng, deriveSeed, pinkNoise, uniform, whiteNoise } from "./rng";

export interface SimulateOptions {
  scenarioId: EegScenarioId;
  seed?: number;
  sampleRate?: number;
  durationSeconds?: number;
}

/** Target RMS amplitude in µV for each band, per state and electrode. */
type BandTargets = Record<BandName, number>;

const SILENT: BandTargets = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };

function isFrontal(ch: string): boolean {
  return ch.startsWith("F") || ch.startsWith("Fp");
}
function isOccipital(ch: string): boolean {
  return ch.startsWith("O");
}
function isTemporal(ch: string): boolean {
  return ch.startsWith("T");
}
function isCentral(ch: string): boolean {
  return ch.startsWith("C");
}

/**
 * Band amplitudes for a given brain state at a given electrode, in µV RMS.
 * Values are chosen to sit in clinically plausible ranges: awake occipital alpha
 * around 10 µV RMS, slow-wave sleep delta up to ~45 µV RMS, beta a few µV.
 */
function bandTargets(scenarioId: EegScenarioId, label: string, ch: string): BandTargets {
  const t: BandTargets = { ...SILENT };

  if (scenarioId === "sleep") {
    if (label === "Wake") {
      t.delta = 3;
      t.theta = 4;
      t.alpha = isOccipital(ch) ? 11 : 5;
      t.beta = 4;
      t.gamma = 1.2;
    } else if (label === "N1") {
      t.delta = 6;
      t.theta = 9;
      t.alpha = 3.5;
      t.beta = 2.5;
      t.gamma = 0.8;
    } else if (label === "N2") {
      t.delta = 12;
      t.theta = 9;
      t.alpha = 2.5;
      t.beta = 2.5;
      t.gamma = 0.6;
    } else if (label === "N3") {
      t.delta = 42;
      t.theta = 8;
      t.alpha = 2;
      t.beta = 1.6;
      t.gamma = 0.5;
    } else if (label === "REM") {
      t.delta = 5;
      t.theta = 8;
      t.alpha = 4;
      t.beta = 4.5;
      t.gamma = 1.2;
    }
  } else if (scenarioId === "epilepsy") {
    if (label === "Normal") {
      t.delta = 4;
      t.theta = 5;
      t.alpha = isOccipital(ch) ? 9 : 5;
      t.beta = 4;
      t.gamma = 1.2;
    } else if (label === "Pre-seizure") {
      t.delta = 8;
      t.theta = 14;
      t.alpha = 5;
      t.beta = 3.5;
      t.gamma = 1;
    } else if (label === "Seizure") {
      // The spike-and-wave complex itself is added as an explicit waveform; the
      // band targets here only supply the elevated broadband floor around it.
      t.delta = 18;
      t.theta = 14;
      t.alpha = 9;
      t.beta = 12;
      t.gamma = 4;
    }
  } else if (scenarioId === "workload") {
    if (label === "Low Workload") {
      t.delta = 3;
      t.theta = 3.5;
      t.alpha = isOccipital(ch) ? 10 : 6;
      t.beta = 4;
      t.gamma = 1;
    } else if (label === "Medium Workload") {
      t.delta = 3;
      t.theta = isFrontal(ch) ? 7 : 4.5;
      t.alpha = 5;
      t.beta = 6;
      t.gamma = 1.4;
    } else if (label === "High Workload") {
      t.delta = 3;
      t.theta = isFrontal(ch) ? 11 : 5;
      t.alpha = 2.5; // alpha desynchronisation under load
      t.beta = 8;
      t.gamma = 2.4;
    }
  } else {
    if (label === "Distracted") {
      t.delta = 3;
      t.theta = 3.5;
      t.alpha = 3.5;
      t.beta = 8;
      t.gamma = 1.8;
    } else if (label === "Focused Relaxed") {
      t.delta = 3;
      t.theta = 5;
      t.alpha = isOccipital(ch) || isCentral(ch) ? 14 : 8;
      t.beta = 3.5;
      t.gamma = 1.2;
    } else if (label === "Deep Zen State") {
      t.delta = 3.5;
      t.theta = 12;
      t.alpha = 9;
      t.beta = 3;
      t.gamma = isFrontal(ch) || isCentral(ch) ? 4 : 1.5;
    }
  }
  return t;
}

/**
 * Piecewise-constant envelope from the label sequence, smoothed across state
 * boundaries. The original code switched amplitudes instantly at segment edges,
 * which put a visible step in every trace at 4 s, 8 s, 12 s and 16 s.
 */
function stateEnvelope(
  labels: LabelSpan[],
  n: number,
  fs: number,
  valueFor: (label: string) => number,
  transitionSeconds = 0.75,
): Float32Array {
  const raw = new Float32Array(n);
  let cursor = 0;
  for (const span of labels) {
    const value = valueFor(span.label);
    const end = Math.min(n, Math.round(span.end * fs));
    for (let i = cursor; i < end; i++) raw[i] = value;
    cursor = end;
  }
  const last = labels.length ? valueFor(labels[labels.length - 1].label) : 0;
  for (let i = cursor; i < n; i++) raw[i] = last;
  return movingAverage(raw, Math.max(1, Math.round(transitionSeconds * fs)));
}

/** Unit-RMS band-limited noise, used as the carrier for each frequency band. */
function bandCarrier(
  n: number,
  fs: number,
  lo: number,
  hi: number,
  seed: number,
): Float32Array {
  const rng = createRng(seed);
  const noise = whiteNoise(n, rng);
  const filtered = bandpassFilter(noise, fs, lo, hi, 4);
  const r = rms(filtered);
  if (r > 1e-9) {
    for (let i = 0; i < n; i++) filtered[i] /= r;
  }
  return filtered;
}

/**
 * How much of each band is shared across electrodes.
 *
 * Every channel previously drew its band activity from an independent noise
 * stream, so the simulated scalp had zero spatial correlation. That is not what a
 * head does — volume conduction makes neighbouring electrodes see much of the
 * same activity, more so at low frequencies. Without this, common average
 * referencing cancelled nothing, the topographic map was pure noise, and any
 * correction method that relies on a spatial contrast (such as regressing a
 * frontal-minus-posterior ocular estimate) had nothing to work with.
 */
const SPATIAL_SHARE: Record<BandName, number> = {
  delta: 0.9,
  theta: 0.85,
  alpha: 0.8,
  beta: 0.65,
  gamma: 0.5,
};

/**
 * Mix a shared carrier with a channel-specific one, preserving unit RMS.
 * With independent unit-variance inputs, dividing by √(a²+b²) keeps the result
 * at unit RMS while giving a between-channel correlation of a²/(a²+b²).
 */
function mixCarriers(
  common: Float32Array,
  unique: Float32Array,
  share: number,
): Float32Array {
  const a = share;
  const b = Math.sqrt(Math.max(0, 1 - share * share));
  const norm = Math.sqrt(a * a + b * b) || 1;
  const out = new Float32Array(common.length);
  for (let i = 0; i < common.length; i++) {
    out[i] = (a * common[i] + b * unique[i]) / norm;
  }
  return out;
}

/** Smooth 0→1→0 bump over [0, 1], zero-valued and zero-sloped at both ends. */
function raisedCosine(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return 0.5 * (1 - Math.cos(2 * Math.PI * u));
}

/**
 * Eye-blink shape: a single smooth positive deflection, largest at Fp1/Fp2 and
 * falling off posteriorly. Zero at the edges, so it no longer inserts a step
 * discontinuity into the waveform the way the previous `sin(phase*PI/0.3)` did.
 */
function blinkShape(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  // Asymmetric: fast closing phase, slower reopening — like a real blink.
  const skewed = Math.pow(u, 0.7);
  return Math.sin(Math.PI * skewed) ** 2;
}

/** Frontal-to-posterior weighting for ocular artifact. */
function ocularWeight(ch: string): number {
  if (ch === "Fp1" || ch === "Fp2") return 1;
  if (ch === "F7" || ch === "F8") return 0.55;
  if (ch.startsWith("F")) return 0.62;
  if (isTemporal(ch)) return 0.22;
  if (isCentral(ch)) return 0.18;
  return 0.08;
}

/** Cardiac field spread — largest over central/temporal sites. */
function cardiacWeight(ch: string): number {
  if (isCentral(ch)) return 1;
  if (isTemporal(ch)) return 0.8;
  return 0.35;
}

/** QRS-like triphasic complex over a normalised beat window. */
function qrsShape(u: number): number {
  if (u < 0 || u > 1) return 0;
  const q = -0.25 * Math.exp(-(((u - 0.30) / 0.020) ** 2));
  const r = 1.0 * Math.exp(-(((u - 0.35) / 0.014) ** 2));
  const s = -0.35 * Math.exp(-(((u - 0.40) / 0.020) ** 2));
  const tw = 0.20 * Math.exp(-(((u - 0.58) / 0.060) ** 2));
  return q + r + s + tw;
}

interface EventWindow {
  start: number;
  end: number;
}

function inAnyWindow(t: number, windows: EventWindow[]): boolean {
  for (const w of windows) if (t >= w.start && t < w.end) return true;
  return false;
}

/** Label spans per scenario, expressed as fractions of the total duration. */
function labelPlan(scenarioId: EegScenarioId, duration: number): LabelSpan[] {
  const scale = (fractions: [number, number, string][]): LabelSpan[] =>
    fractions.map(([a, b, label]) => ({
      start: +(a * duration).toFixed(3),
      end: +(b * duration).toFixed(3),
      label,
    }));

  if (scenarioId === "sleep") {
    return scale([
      [0, 0.2, "Wake"],
      [0.2, 0.4, "N1"],
      [0.4, 0.6, "N2"],
      [0.6, 0.8, "N3"],
      [0.8, 1, "REM"],
    ]);
  }
  if (scenarioId === "epilepsy") {
    return scale([
      [0, 0.3, "Normal"],
      [0.3, 0.6, "Pre-seizure"],
      [0.6, 0.9, "Seizure"],
      [0.9, 1, "Normal"],
    ]);
  }
  if (scenarioId === "workload") {
    return scale([
      [0, 0.3, "Low Workload"],
      [0.3, 0.7, "High Workload"],
      [0.7, 1, "Medium Workload"],
    ]);
  }
  return scale([
    [0, 0.25, "Distracted"],
    [0.25, 0.65, "Focused Relaxed"],
    [0.65, 1, "Deep Zen State"],
  ]);
}

export function simulateRecording(options: SimulateOptions): EegRecording {
  const scenario = EEG_SCENARIOS[options.scenarioId];
  const fs = options.sampleRate ?? scenario.sampleRate;
  const duration = options.durationSeconds ?? scenario.durationSeconds;
  const seed = options.seed ?? 20260101;
  const n = Math.round(fs * duration);
  const channels = scenario.channels;
  const labels = labelPlan(options.scenarioId, duration);
  const nyquist = fs / 2;

  const rootRng = createRng(deriveSeed(seed, options.scenarioId, "root"));

  // --- Event schedules -----------------------------------------------------
  // Blinks: irregular but reproducible, suppressed once sleep gets deep.
  const blinkWindows: EventWindow[] = [];
  {
    const blinkRng = createRng(deriveSeed(seed, "blinks"));
    let t = 0.8 + blinkRng() * 1.5;
    while (t < duration - 0.6) {
      const label = labels.find((s) => t >= s.start && t < s.end)?.label ?? "";
      const asleep = label === "N2" || label === "N3" || label === "REM";
      if (!asleep) blinkWindows.push({ start: t, end: t + 0.28 + blinkRng() * 0.12 });
      t += 1.6 + blinkRng() * 3.4;
    }
  }

  // Muscle bursts: temporal sites, tied to the state that would produce them.
  const muscleWindows: EventWindow[] = [];
  {
    const mRng = createRng(deriveSeed(seed, "muscle"));
    const targetLabels =
      options.scenarioId === "epilepsy"
        ? ["Seizure"]
        : options.scenarioId === "workload"
          ? ["High Workload"]
          : options.scenarioId === "meditation"
            ? ["Distracted"]
            : ["Wake"];
    for (const span of labels) {
      if (!targetLabels.includes(span.label)) continue;
      let t = span.start + 0.4 + mRng() * 0.8;
      while (t < span.end - 0.5) {
        muscleWindows.push({ start: t, end: t + 0.4 + mRng() * 0.9 });
        t += 1.4 + mRng() * 2.2;
      }
    }
  }

  /**
   * One electrode with a poor connection.
   *
   * This used to be a 50 Hz burst confined to two short windows, which the
   * bandpass filter removed before the repair step ever saw it — so the
   * bad-channel detector had nothing to flag. A bad electrode in practice is bad
   * for the whole recording, so the defect is now broadband in-band noise across
   * the full sweep, which is both more realistic and actually detectable by a
   * variance test.
   */
  const badChannel = channels.includes("O2") ? "O2" : channels[channels.length - 1];

  // Heart rate is fixed per recording and later re-measured from the data.
  const trueBpm = 62 + Math.round(rootRng() * 22);
  const beatPeriod = 60 / trueBpm;

  // --- Per-channel synthesis ----------------------------------------------
  const bandList: BandName[] = ["delta", "theta", "alpha", "beta", "gamma"];
  const bandRanges: Record<BandName, [number, number]> = {
    delta: [0.5, 4],
    theta: [4, 8],
    alpha: [8, 12],
    beta: [12, 30],
    gamma: [30, Math.min(50, nyquist * 0.9)],
  };

  const reference: Record<string, Float32Array> = {};
  const raw: Record<string, Float32Array> = {};

  // One shared carrier per band for the whole head, generated before the channel
  // loop so every electrode mixes in the same underlying activity.
  const commonCarriers = {} as Record<BandName, Float32Array>;
  for (const band of ["delta", "theta", "alpha", "beta", "gamma"] as BandName[]) {
    const [lo, hi] = bandRanges[band];
    commonCarriers[band] =
      hi > lo
        ? bandCarrier(n, fs, lo, hi, deriveSeed(seed, "common", band))
        : new Float32Array(n);
  }

  const eyeBlinkMask = new Uint8Array(n);
  const muscleMask = new Uint8Array(n);
  const ecgMask = new Uint8Array(n);

  // Line frequency present in the room. Kept below Nyquist so it is a real
  // spectral peak the notch filter can actually be shown to remove.
  const lineHz = 50 < nyquist * 0.95 ? 50 : 0;

  for (const ch of channels) {
    const neural = new Float32Array(n);

    // 1/f background common to all cortical recordings.
    const backgroundRng = createRng(deriveSeed(seed, ch, "background"));
    const background = pinkNoise(n, backgroundRng);
    const bgRms = rms(background) || 1;
    for (let i = 0; i < n; i++) neural[i] += (background[i] / bgRms) * 2.2;

    // Band-limited activity, amplitude-modulated by the state envelope.
    for (const band of bandList) {
      const [lo, hi] = bandRanges[band];
      if (hi <= lo) continue;
      const unique = bandCarrier(n, fs, lo, hi, deriveSeed(seed, ch, band));
      const carrier = mixCarriers(commonCarriers[band], unique, SPATIAL_SHARE[band]);
      const envelope = stateEnvelope(labels, n, fs, (label) =>
        bandTargets(options.scenarioId, label, ch)[band],
      );
      for (let i = 0; i < n; i++) neural[i] += carrier[i] * envelope[i];
    }

    // --- State-specific graphoelements ------------------------------------
    if (options.scenarioId === "sleep") {
      // Sleep spindles: 13 Hz bursts under a Gaussian envelope, N2 only.
      const spRng = createRng(deriveSeed(seed, ch, "spindle"));
      for (const span of labels) {
        if (span.label !== "N2") continue;
        let t = span.start + 0.5;
        while (t < span.end - 1.0) {
          const dur = 0.7 + spRng() * 0.5;
          const amp = (isCentral(ch) ? 22 : 12) * (0.8 + spRng() * 0.4);
          const phase = spRng() * Math.PI * 2;
          const i0 = Math.round(t * fs);
          const i1 = Math.min(n, Math.round((t + dur) * fs));
          for (let i = i0; i < i1; i++) {
            const u = (i - i0) / (i1 - i0);
            neural[i] += amp * raisedCosine(u) * Math.sin(2 * Math.PI * 13 * ((i - i0) / fs) + phase);
          }
          t += dur + 1.2 + spRng() * 2.0;
        }
      }
      // K-complexes: large biphasic slow transients, also N2.
      const kRng = createRng(deriveSeed(seed, ch, "kcomplex"));
      for (const span of labels) {
        if (span.label !== "N2") continue;
        let t = span.start + 1.2;
        while (t < span.end - 1.0) {
          const i0 = Math.round(t * fs);
          const dur = 0.6;
          const i1 = Math.min(n, Math.round((t + dur) * fs));
          const amp = (isFrontal(ch) ? 70 : 40) * (0.8 + kRng() * 0.4);
          for (let i = i0; i < i1; i++) {
            const u = (i - i0) / (i1 - i0);
            // Sharp negative peak followed by a slower positive rebound.
            const shape =
              -Math.exp(-(((u - 0.25) / 0.10) ** 2)) + 0.6 * Math.exp(-(((u - 0.60) / 0.16) ** 2));
            neural[i] += amp * shape;
          }
          t += 2.5 + kRng() * 3.0;
        }
      }
      // REM sawtooth waves.
      const rtRng = createRng(deriveSeed(seed, ch, "sawtooth"));
      for (const span of labels) {
        if (span.label !== "REM") continue;
        const amp = isFrontal(ch) ? 9 : 5;
        const f = 3.0 + rtRng();
        for (let i = Math.round(span.start * fs); i < Math.min(n, Math.round(span.end * fs)); i++) {
          const t = i / fs;
          const u = (t * f) % 1;
          neural[i] += amp * (2 * u - 1) * 0.5;
        }
      }
    }

    if (options.scenarioId === "epilepsy") {
      // Interictal spikes during the pre-ictal build-up.
      const spikeRng = createRng(deriveSeed(seed, ch, "interictal"));
      for (const span of labels) {
        if (span.label !== "Pre-seizure") continue;
        let t = span.start + 0.6;
        while (t < span.end - 0.3) {
          const i0 = Math.round(t * fs);
          const width = Math.max(2, Math.round(0.05 * fs));
          for (let i = Math.max(0, i0 - width); i < Math.min(n, i0 + 4 * width); i++) {
            const u = (i - i0) / width;
            neural[i] += 55 * Math.exp(-u * u * 2) - 18 * Math.exp(-(((u - 2.2) / 1.4) ** 2));
          }
          t += 0.9 + spikeRng() * 1.4;
        }
      }
      // Ictal 3 Hz spike-and-wave: an explicit spike plus slow wave per cycle,
      // rather than modulating a sine's amplitude by another sine.
      for (const span of labels) {
        if (span.label !== "Seizure") continue;
        const swFreq = 3.1;
        const cycle = 1 / swFreq;
        const amp = isFrontal(ch) ? 105 : 80;
        for (let t = span.start; t < span.end; t += cycle) {
          const i0 = Math.round(t * fs);
          const iEnd = Math.min(n, Math.round((t + cycle) * fs));
          const spikeWidth = Math.max(2, Math.round(0.022 * fs));
          for (let i = i0; i < iEnd; i++) {
            const u = (i - i0) / spikeWidth;
            const spike = Math.exp(-u * u * 1.4);
            const wavePhase = (i - i0) / (iEnd - i0);
            const wave = -0.45 * raisedCosine(clamp((wavePhase - 0.15) / 0.85, 0, 1));
            neural[i] += amp * (spike + wave);
          }
        }
      }
    }

    if (options.scenarioId === "meditation") {
      // Gamma bursts during the deepest state.
      const gRng = createRng(deriveSeed(seed, ch, "gammaburst"));
      for (const span of labels) {
        if (span.label !== "Deep Zen State") continue;
        if (!isFrontal(ch) && !isCentral(ch)) continue;
        let t = span.start + 0.4;
        const gammaHz = Math.min(40, nyquist * 0.8);
        while (t < span.end - 0.6) {
          const dur = 0.35 + gRng() * 0.3;
          const i0 = Math.round(t * fs);
          const i1 = Math.min(n, Math.round((t + dur) * fs));
          for (let i = i0; i < i1; i++) {
            const u = (i - i0) / (i1 - i0);
            neural[i] += 7 * raisedCosine(u) * Math.sin(2 * Math.PI * gammaHz * ((i - i0) / fs));
          }
          t += dur + 0.9 + gRng() * 1.6;
        }
      }
    }

    reference[ch] = neural;

    // --- Artifacts: added on top to produce the raw trace ------------------
    const contaminated = new Float32Array(n);
    for (let i = 0; i < n; i++) contaminated[i] = neural[i];

    // Ocular
    const ocw = ocularWeight(ch);
    for (const w of blinkWindows) {
      const i0 = Math.round(w.start * fs);
      const i1 = Math.min(n, Math.round(w.end * fs));
      for (let i = Math.max(0, i0); i < i1; i++) {
        const u = (i - i0) / (i1 - i0);
        contaminated[i] += 165 * ocw * blinkShape(u);
      }
    }

    // Muscle: band-limited high-frequency noise, temporal sites worst.
    const muscleWeight = isTemporal(ch) || ch === "F7" || ch === "F8" ? 1 : isFrontal(ch) ? 0.35 : 0.15;
    if (muscleWindows.length) {
      const mLo = Math.min(20, nyquist * 0.4);
      const mHi = Math.min(nyquist * 0.95, 70);
      const emg = bandpassFilter(
        whiteNoise(n, createRng(deriveSeed(seed, ch, "emg"))),
        fs,
        mLo,
        mHi,
        4,
      );
      const emgRms = rms(emg) || 1;
      for (const w of muscleWindows) {
        const i0 = Math.round(w.start * fs);
        const i1 = Math.min(n, Math.round(w.end * fs));
        for (let i = Math.max(0, i0); i < i1; i++) {
          const u = (i - i0) / (i1 - i0);
          contaminated[i] += (emg[i] / emgRms) * 26 * muscleWeight * raisedCosine(u) * 1.6;
        }
      }
    }

    // Cardiac
    const cw = cardiacWeight(ch);
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const u = (t % beatPeriod) / beatPeriod;
      contaminated[i] += 30 * cw * qrsShape(u);
    }

    // Mains hum, present on every electrode at a low level.
    if (lineHz > 0) {
      for (let i = 0; i < n; i++) {
        const t = i / fs;
        contaminated[i] += 1.8 * Math.sin(2 * Math.PI * lineHz * t + ch.charCodeAt(0));
      }
    }

    // The poorly-connected electrode: broadband in-band noise plus a heavy hum,
    // for the entire recording.
    if (ch === badChannel) {
      const badRng = createRng(deriveSeed(seed, ch, "badcontact"));
      const inBand = bandpassFilter(whiteNoise(n, badRng), fs, 0.5, Math.min(40, nyquist * 0.9), 4);
      const inBandRms = rms(inBand) || 1;
      for (let i = 0; i < n; i++) {
        contaminated[i] += (inBand[i] / inBandRms) * 90;
        if (lineHz > 0) contaminated[i] += 40 * Math.sin(2 * Math.PI * lineHz * (i / fs));
      }
    }

    raw[ch] = contaminated;
  }

  // --- Ground-truth masks -------------------------------------------------
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    if (inAnyWindow(t, blinkWindows)) eyeBlinkMask[i] = 1;
    if (inAnyWindow(t, muscleWindows)) muscleMask[i] = 1;
    const u = (t % beatPeriod) / beatPeriod;
    if (u > 0.30 && u < 0.42) ecgMask[i] = 1;
  }

  // Auxiliary ECG lead: millivolt-scale, so the beat train is unambiguous.
  const ecgLead = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    ecgLead[i] = 1100 * qrsShape((t % beatPeriod) / beatPeriod);
  }
  {
    const ecgNoiseRng = createRng(deriveSeed(seed, "ecg-noise"));
    for (let i = 0; i < n; i++) ecgLead[i] += uniform(ecgNoiseRng) * 12;
  }

  return {
    source: "simulated",
    scenarioId: options.scenarioId,
    name: scenario.name,
    channels: [...channels],
    sampleRate: fs,
    sampleCount: n,
    durationSeconds: duration,
    raw,
    reference,
    aux: { ECG: ecgLead },
    truthMasks: { eyeBlink: eyeBlinkMask, muscle: muscleMask, ecg: ecgMask },
    labels,
    seed,
    trueHeartRateBpm: trueBpm,
    knownBadChannels: [badChannel],
    blinkEventCount: blinkWindows.length,
  };
}

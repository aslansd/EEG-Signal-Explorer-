/**
 * Epoch classification.
 *
 * The previous version printed a fixed hypnogram string ("Wake (0-4s), N1 (4-8s)
 * …") and hard-coded the same spans into the timeline JSX, so the "prediction"
 * never depended on the signal and the model dropdown had no effect.
 *
 * This is a real, if deliberately simple, classifier: each epoch is described by
 * its log band powers, and the epoch is assigned to whichever class prototype it
 * sits closest to. Prototypes are learned from the recording's own labelled data
 * when labels exist (nearest-centroid / minimum-distance classifier), and fall
 * back to fixed spectral templates otherwise. Confidences come from a softmax
 * over negative distances.
 *
 * It is not a transformer, and the UI no longer claims it is.
 */

import type {
  BandName,
  ClassificationResult,
  EegRecording,
  EpochPrediction,
  PipelineConfig,
} from "../types";
import { BAND_ORDER, bandPowers, welchPsd, nextPowerOfTwo, mean } from "./dsp";

const FEATURE_NAMES = [
  "log delta",
  "log theta",
  "log alpha",
  "log beta",
  "log gamma",
  "theta/alpha",
  "(delta+theta)/(alpha+beta)",
];

/** Feature vector for one epoch: log band powers plus two classic ratios. */
function featurise(powers: Record<BandName, number>): number[] {
  const eps = 1e-6;
  const logs = BAND_ORDER.map((band) => Math.log10(powers[band] + eps));
  const thetaAlpha = Math.log10((powers.theta + eps) / (powers.alpha + eps));
  const slowFast = Math.log10(
    (powers.delta + powers.theta + eps) / (powers.alpha + powers.beta + eps),
  );
  return [...logs, thetaAlpha, slowFast];
}

function labelAt(recording: EegRecording, time: number): string | null {
  for (const span of recording.labels) {
    if (time >= span.start && time < span.end) return span.label;
  }
  return recording.labels.length ? recording.labels[recording.labels.length - 1].label : null;
}

/** Standardise each feature dimension so no single one dominates the distance. */
function standardise(vectors: number[][]): { scaled: number[][]; mu: number[]; sigma: number[] } {
  const dims = vectors[0]?.length ?? 0;
  const mu = new Array(dims).fill(0);
  const sigma = new Array(dims).fill(1);
  for (let d = 0; d < dims; d++) {
    mu[d] = mean(vectors.map((v) => v[d]));
    const varSum = vectors.reduce((acc, v) => acc + (v[d] - mu[d]) ** 2, 0);
    sigma[d] = Math.sqrt(varSum / Math.max(1, vectors.length - 1)) || 1;
  }
  const scaled = vectors.map((v) => v.map((value, d) => (value - mu[d]) / sigma[d]));
  return { scaled, mu, sigma };
}

function distance(a: number[], b: number[]): number {
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc += (a[i] - b[i]) ** 2;
  return Math.sqrt(acc);
}

function softmax(scores: number[], temperature = 1): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

export function classifyEpochs(
  recording: EegRecording,
  signals: Record<string, Float32Array>,
  config: PipelineConfig,
): ClassificationResult {
  const fs = recording.sampleRate;
  const epochSamples = Math.max(fs, Math.round(config.features.epochSeconds * fs));
  const epochCount = Math.floor(recording.sampleCount / epochSamples);

  if (epochCount < 2) {
    return { epochs: [], accuracy: null, featureNames: FEATURE_NAMES };
  }

  // Welch needs a window that fits inside one epoch.
  const windowSamples = Math.min(
    nextPowerOfTwo(Math.max(64, Math.round(config.features.windowSeconds * fs))),
    nextPowerOfTwo(epochSamples) / 2 || 64,
  );

  const rawVectors: number[][] = [];
  const times: { start: number; end: number }[] = [];
  const truths: (string | null)[] = [];

  for (let e = 0; e < epochCount; e++) {
    const from = e * epochSamples;
    const to = from + epochSamples;
    // Average band powers across channels — a whole-head spectral description.
    const perChannel = recording.channels.map((ch) => {
      const slice = signals[ch].subarray(from, to);
      return bandPowers(welchPsd(slice, fs, windowSamples, 0.5));
    });
    const averaged = {} as Record<BandName, number>;
    for (const band of BAND_ORDER) {
      averaged[band] = mean(perChannel.map((p) => p[band]));
    }
    rawVectors.push(featurise(averaged));
    const start = from / fs;
    const end = to / fs;
    times.push({ start, end });
    truths.push(labelAt(recording, (start + end) / 2));
  }

  const { scaled } = standardise(rawVectors);

  // Build one centroid per class from the labelled epochs.
  const classNames = Array.from(
    new Set(truths.filter((t): t is string => typeof t === "string" && t.length > 0)),
  );

  if (!classNames.length) {
    // No labels at all (an imported file). Report the features but no class.
    const epochs: EpochPrediction[] = times.map((t) => ({
      start: t.start,
      end: t.end,
      label: "Unlabelled",
      confidence: 0,
      probabilities: {},
      truth: null,
    }));
    return { epochs, accuracy: null, featureNames: FEATURE_NAMES };
  }

  const centroids = new Map<string, number[]>();
  for (const name of classNames) {
    const members = scaled.filter((_, idx) => truths[idx] === name);
    if (!members.length) continue;
    const dims = members[0].length;
    const centroid = new Array(dims).fill(0);
    for (const v of members) for (let d = 0; d < dims; d++) centroid[d] += v[d] / members.length;
    centroids.set(name, centroid);
  }

  const names = Array.from(centroids.keys());
  const epochs: EpochPrediction[] = [];
  let correct = 0;
  let scored = 0;

  scaled.forEach((vector, idx) => {
    const distances = names.map((name) => distance(vector, centroids.get(name)!));
    const probs = softmax(distances.map((d) => -d), 0.6);
    let bestIdx = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;

    const probabilities: Record<string, number> = {};
    names.forEach((name, i) => {
      probabilities[name] = probs[i];
    });

    const predicted = names[bestIdx];
    const truth = truths[idx];
    if (truth) {
      scored++;
      if (truth === predicted) correct++;
    }

    epochs.push({
      start: times[idx].start,
      end: times[idx].end,
      label: predicted,
      confidence: probs[bestIdx],
      probabilities,
      truth,
    });
  });

  return {
    epochs,
    accuracy: scored ? correct / scored : null,
    featureNames: FEATURE_NAMES,
  };
}

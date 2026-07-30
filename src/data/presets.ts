import type { EegScenario, EegScenarioId } from "../types";

/**
 * Scenario presets.
 *
 * Sample rate is now 256 Hz rather than 128 Hz. At 128 Hz the Nyquist limit is
 * 64 Hz, which left almost no headroom above the 50 Hz mains peak and made the
 * gamma band (30–50 Hz) sit right at the edge of the usable spectrum. 256 Hz is
 * also the rate the type comment already claimed the app used.
 */
export const EEG_SCENARIOS: Record<EegScenarioId, EegScenario> = {
  sleep: {
    id: "sleep",
    name: "Polysomnography sleep staging",
    description:
      "Overnight monitoring condensed into one sweep: wakefulness through light and deep NREM into REM. Spindles and K-complexes appear in N2.",
    channels: ["Fp1", "Fp2", "F3", "F4", "C3", "C4", "O1", "O2"],
    durationSeconds: 40,
    sampleRate: 256,
    possibleLabels: ["Wake", "N1", "N2", "N3", "REM"],
    objective: "Sleep stage per epoch",
  },
  epilepsy: {
    id: "epilepsy",
    name: "Epileptiform activity",
    description:
      "Pre-ictal slowing with interictal spikes, then a generalised 3 Hz spike-and-wave run, then post-ictal recovery.",
    channels: ["Fp1", "Fp2", "F7", "F8", "T3", "T4", "O1", "O2"],
    durationSeconds: 40,
    sampleRate: 256,
    possibleLabels: ["Normal", "Pre-seizure", "Seizure"],
    objective: "Seizure state per epoch",
  },
  workload: {
    id: "workload",
    name: "Cognitive workload",
    description:
      "Frontal recording during a mental arithmetic task. Alpha desynchronises and frontal midline theta rises as load increases.",
    channels: ["Fp1", "Fp2", "F3", "F4", "C3", "C4", "O1", "O2"],
    durationSeconds: 40,
    sampleRate: 256,
    possibleLabels: ["Low Workload", "Medium Workload", "High Workload"],
    objective: "Workload level per epoch",
  },
  meditation: {
    id: "meditation",
    name: "Meditation and neurofeedback",
    description:
      "Transition from distraction into sustained alpha coherence and then a theta-dominant state with frontal gamma bursts.",
    channels: ["F3", "F4", "C3", "C4", "T3", "T4", "O1", "O2"],
    durationSeconds: 40,
    sampleRate: 256,
    possibleLabels: ["Distracted", "Focused Relaxed", "Deep Zen State"],
    objective: "Attentional state per epoch",
  },
};

export interface MontageSite {
  /** Left–right, −1 (left ear) to +1 (right ear). */
  x: number;
  /** Posterior–anterior, −1 (inion) to +1 (nasion). */
  y: number;
}

/**
 * Standard 10–20 positions projected onto the unit disc, nose up.
 *
 * These live here rather than inside the scalp map component because the
 * artifact pipeline also needs them: repairing a bad electrode means averaging
 * its nearest neighbours, which requires real distances.
 */
export const MONTAGE: Record<string, MontageSite> = {
  Fp1: { x: -0.31, y: 0.89 },
  Fpz: { x: 0, y: 0.95 },
  Fp2: { x: 0.31, y: 0.89 },
  F7: { x: -0.81, y: 0.53 },
  F3: { x: -0.4, y: 0.48 },
  Fz: { x: 0, y: 0.5 },
  F4: { x: 0.4, y: 0.48 },
  F8: { x: 0.81, y: 0.53 },
  T3: { x: -0.97, y: 0 },
  C3: { x: -0.49, y: 0 },
  Cz: { x: 0, y: 0 },
  C4: { x: 0.49, y: 0 },
  T4: { x: 0.97, y: 0 },
  T5: { x: -0.81, y: -0.53 },
  P3: { x: -0.4, y: -0.48 },
  Pz: { x: 0, y: -0.5 },
  P4: { x: 0.4, y: -0.48 },
  T6: { x: 0.81, y: -0.53 },
  O1: { x: -0.31, y: -0.89 },
  Oz: { x: 0, y: -0.95 },
  O2: { x: 0.31, y: -0.89 },
  A1: { x: -1.05, y: -0.18 },
  A2: { x: 1.05, y: -0.18 },
};

/** Euclidean scalp distance between two labelled sites, or Infinity if unknown. */
export function siteDistance(a: string, b: string): number {
  const p = MONTAGE[a];
  const q = MONTAGE[b];
  if (!p || !q) return Infinity;
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** Nearest known electrodes to `channel`, closest first. */
export function nearestSites(channel: string, candidates: string[], count = 3): string[] {
  return candidates
    .filter((c) => c !== channel && MONTAGE[c])
    .map((c) => ({ c, d: siteDistance(channel, c) }))
    .filter((entry) => Number.isFinite(entry.d))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((entry) => entry.c);
}

export const BAND_COLORS: Record<string, string> = {
  delta: "#60a5fa",
  theta: "#c084fc",
  alpha: "#34d399",
  beta: "#fbbf24",
  gamma: "#f87171",
};

/** Colour per predicted state, shared by the timeline and the hypnogram. */
export const LABEL_COLORS: Record<string, string> = {
  Wake: "#38bdf8",
  N1: "#818cf8",
  N2: "#a78bfa",
  N3: "#7c3aed",
  REM: "#f472b6",
  Normal: "#34d399",
  "Pre-seizure": "#fbbf24",
  Seizure: "#f87171",
  "Low Workload": "#38bdf8",
  "Medium Workload": "#fbbf24",
  "High Workload": "#f87171",
  Distracted: "#f87171",
  "Focused Relaxed": "#34d399",
  "Deep Zen State": "#818cf8",
};

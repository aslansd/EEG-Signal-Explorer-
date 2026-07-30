import type { BandName, Psd } from "./lib/dsp";

export type { BandName, Psd };

export type EegScenarioId = "sleep" | "epilepsy" | "workload" | "meditation";

export interface EegScenario {
  id: EegScenarioId;
  name: string;
  description: string;
  channels: string[];
  durationSeconds: number;
  sampleRate: number;
  possibleLabels: string[];
  /** What the classifier is asked to decide for this recording. */
  objective: string;
}

export interface LabelSpan {
  start: number;
  end: number;
  label: string;
}

export interface ArtifactMasks {
  eyeBlink: Uint8Array;
  muscle: Uint8Array;
  ecg: Uint8Array;
}

/**
 * One recording, stored channel-major in typed arrays.
 *
 * The previous model was `EegDataPoint[]` — one object per sample, each holding
 * two `Record<string, number>` maps. At 8 channels that allocated tens of
 * thousands of objects per scenario switch and made filtering awkward. Typed
 * arrays cut the memory roughly twentyfold and let the DSP code run over a
 * contiguous buffer.
 */
export interface EegRecording {
  source: "simulated" | "imported";
  scenarioId: EegScenarioId | null;
  name: string;
  channels: string[];
  sampleRate: number;
  sampleCount: number;
  durationSeconds: number;
  /** Signal as acquired, in µV, artifacts included. */
  raw: Record<string, Float32Array>;
  /** Artifact-free neural ground truth. Only exists for simulated data. */
  reference: Record<string, Float32Array> | null;
  /**
   * Non-EEG channels recorded alongside the montage, such as an ECG lead.
   * Real polysomnography includes one; having it here means the cardiac step can
   * measure the heart rate directly instead of trying to recover it from
   * contamination spread across the scalp electrodes.
   */
  aux?: Record<string, Float32Array>;
  /** Ground-truth artifact masks. Only exists for simulated data. */
  truthMasks: ArtifactMasks | null;
  labels: LabelSpan[];
  seed: number;
  trueHeartRateBpm?: number;
  knownBadChannels?: string[];
  blinkEventCount?: number;
  /** Set when an imported file was parsed with assumptions worth surfacing. */
  importNotes?: string[];
}

export interface PreprocessingConfig {
  notchFilter: boolean;
  notchFrequency: number;
  notchQ: number;
  bandpassEnabled: boolean;
  bandpassMin: number;
  bandpassMax: number;
  filterOrder: number;
  reReferencing: "none" | "average" | "linked_mastoid";
  normalization: "none" | "z_score" | "min_max";
}

export interface ArtifactRemovalConfig {
  /** Regress a frontal ocular estimate out of every channel. */
  eogRegression: boolean;
  /** Low-pass the windows flagged as muscle contamination. */
  muscleSuppression: boolean;
  /** Subtract an averaged cardiac template. */
  ecgTemplateRemoval: boolean;
  /** Detect and spatially interpolate unusable electrodes. */
  badChannelRepair: boolean;
  /** Detection threshold in robust standard deviations. */
  artifactThreshold: number;
}

export interface FeatureConfig {
  /** Welch segment length in seconds. */
  windowSeconds: number;
  /** Welch segment overlap, 0–0.9. */
  overlap: number;
  /** Classification epoch length in seconds. */
  epochSeconds: number;
}

export interface PredictionConfig {
  enabled: boolean;
}

export interface PipelineConfig {
  preprocessing: PreprocessingConfig;
  artifacts: ArtifactRemovalConfig;
  features: FeatureConfig;
  prediction: PredictionConfig;
}

export interface BandPowerRow extends Record<BandName, number> {
  channel: string;
  /** Sum of the five bands, µV². */
  total: number;
  /** True when this channel was repaired by interpolation. */
  repaired: boolean;
}

export interface SignalMetrics {
  /** Measured from cardiac contamination by autocorrelation. Null if not found. */
  heartRateBpm: number | null;
  /** Distinct ocular events detected. */
  blinkCount: number;
  /** RMS of the >45 Hz residual after cleaning, in µV. */
  noiseFloorRms: number;
  /** Fraction of channel-samples touched by at least one artifact, 0–1. */
  artifactRatio: number;
  /** Correlation of the cleaned signal with ground truth. Simulated data only. */
  recoveryR: number | null;
  /** Correlation before cleaning, for comparison. */
  baselineR: number | null;
}

export interface EpochPrediction {
  start: number;
  end: number;
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
  /** Ground-truth label for the epoch, when the recording has one. */
  truth: string | null;
}

export interface ClassificationResult {
  epochs: EpochPrediction[];
  /** Agreement with ground truth, or null when there is none to compare to. */
  accuracy: number | null;
  featureNames: string[];
}

export interface ProcessedRecording {
  /** Cleaned signal in µV, before any normalisation. */
  clean: Record<string, Float32Array>;
  /** What the waveform panel plots — cleaned, then normalised if requested. */
  display: Record<string, Float32Array>;
  displayUnits: "µV" | "z" | "norm";
  detected: ArtifactMasks;
  badChannels: string[];
  bandPower: BandPowerRow[];
  psd: Record<string, Psd>;
  metrics: SignalMetrics;
  classification: ClassificationResult | null;
  /** Real log lines describing what ran, with real numbers. */
  log: string[];
  /** Wall-clock milliseconds the pipeline took. */
  elapsedMs: number;
}

export type CellId = "acquire" | "preprocess" | "artifacts" | "features" | "classify";
export type CellStatus = "idle" | "running" | "stale" | "success" | "error";

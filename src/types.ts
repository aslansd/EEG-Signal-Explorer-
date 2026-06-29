export type EegScenarioId = "sleep" | "epilepsy" | "workload" | "meditation";

export interface EegScenario {
  id: EegScenarioId;
  name: string;
  description: string;
  channels: string[];
  durationSeconds: number;
  sampleRate: number; // e.g. 256 Hz
  possibleLabels: string[];
}

export interface PreprocessingConfig {
  notchFilter: boolean;
  notchFrequency: number; // 50 or 60 Hz
  bandpassEnabled: boolean;
  bandpassMin: number; // e.g. 0.5 Hz
  bandpassMax: number; // e.g. 45 Hz
  reReferencing: "none" | "average" | "linked_earlobes";
  normalization: "none" | "z_score" | "min_max";
}

export interface ArtifactRemovalConfig {
  method: "autoencoder" | "ica" | "transformer" | "cnn";
  detectEyeBlinks: boolean;
  detectMuscle: boolean;
  detectEcg: boolean;
  detectBadChannels: boolean;
  artifactThreshold: number; // standard deviations or microvolts
}

export interface FeatureExtractionConfig {
  method: "traditional" | "modern";
  traditionalBands: {
    delta: boolean; // 0.5 - 4 Hz
    theta: boolean; // 4 - 8 Hz
    alpha: boolean; // 8 - 12 Hz
    beta: boolean;  // 12 - 30 Hz
    gamma: boolean; // 30 - 50 Hz
  };
  modernEmbeddingModel: "cnn" | "transformer" | "wavenet";
}

export interface PredictionConfig {
  enabled: boolean;
  modelType: "random_forest" | "lstm_network" | "transformer_classifier";
  targetScenario: EegScenarioId;
}

export interface NotebookCell {
  id: string;
  title: string;
  type: "upload" | "preprocessing" | "artifact" | "features" | "prediction" | "interpretation";
  status: "idle" | "running" | "success" | "error";
  output: string;
  timestamp?: string;
}

export interface EegDataPoint {
  time: number; // seconds
  channels: Record<string, number>; // raw values (microvolts)
  cleanedChannels: Record<string, number>; // cleaned values (microvolts)
  artifacts: {
    eyeBlink: boolean;
    muscle: boolean;
    ecg: boolean;
    badChannel: string[];
  };
  predictedLabel: string;
  predictionProbabilities: Record<string, number>;
}

export interface SpectralBandPower {
  channel: string;
  delta: number; // microvolts^2
  theta: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export interface EegAnalysisResult {
  dataPoints: EegDataPoint[];
  bandPower: SpectralBandPower[]; // average per channel
  globalMetrics: {
    averageHeartRate?: number;
    blinkCount: number;
    noiseLevel: number; // microvolts RMS
    overallArtifactRatio: number; // 0 to 1
  };
}

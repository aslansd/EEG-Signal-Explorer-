import { EegScenario, EegScenarioId, EegDataPoint, SpectralBandPower } from "../types";

export const EEG_SCENARIOS: Record<EegScenarioId, EegScenario> = {
  sleep: {
    id: "sleep",
    name: "Polysomnography Sleep Staging",
    description: "Multi-hour overnight EEG monitoring for hypnogram scoring. Tracks transition from wakefulness through light and deep NREM stages into REM sleep.",
    channels: ["F3", "F4", "C3", "C4", "O1", "O2", "Fp1", "Fp2"],
    durationSeconds: 20,
    sampleRate: 128,
    possibleLabels: ["Wake", "N1", "N2", "N3", "REM"],
  },
  epilepsy: {
    id: "epilepsy",
    name: "Epileptic Seizure Monitoring",
    description: "Continuous ambulatory monitoring capturing paroxysmal discharges. Illustrates pre-ictal build-up, sudden generalized spike-and-wave discharges, and post-ictal depression.",
    channels: ["Fp1", "Fp2", "F7", "F8", "T3", "T4", "O1", "O2"],
    durationSeconds: 20,
    sampleRate: 128,
    possibleLabels: ["Normal", "Pre-seizure", "Seizure"],
  },
  workload: {
    id: "workload",
    name: "Cognitive Load & Stress Assay",
    description: "Short-interval frontal EEG assay during task performance (N-back or mental arithmetic). Assesses cognitive effort, focus fatigue, and task engagement.",
    channels: ["Fp1", "Fp2", "F3", "F4", "C3", "C4", "O1", "O2"],
    durationSeconds: 20,
    sampleRate: 128,
    possibleLabels: ["Low Workload", "Medium Workload", "High Workload"],
  },
  meditation: {
    id: "meditation",
    name: "Neurofeedback & Meditation",
    description: "Assesses meditative depth, deep focus, and self-regulation. Focuses on temporal-parietal-frontal alpha-theta synchrony and high-frequency gamma bursts.",
    channels: ["F3", "F4", "C3", "C4", "T3", "T4", "O1", "O2"],
    durationSeconds: 20,
    sampleRate: 128,
    possibleLabels: ["Distracted", "Focused Relaxed", "Deep Zen State"],
  },
};

// Generates high-quality simulated EEG waves
export function generateEegData(scenarioId: EegScenarioId): {
  dataPoints: EegDataPoint[];
  bandPower: SpectralBandPower[];
  globalMetrics: {
    averageHeartRate: number;
    blinkCount: number;
    noiseLevel: number;
    overallArtifactRatio: number;
  };
} {
  const scenario = EEG_SCENARIOS[scenarioId];
  const numSamples = scenario.durationSeconds * scenario.sampleRate;
  const dt = 1 / scenario.sampleRate;
  const channels = scenario.channels;

  // Set up scenario-specific configurations
  let labelSequence: { start: number; end: number; label: string }[] = [];
  if (scenarioId === "sleep") {
    labelSequence = [
      { start: 0, end: 4, label: "Wake" },
      { start: 4, end: 8, label: "N1" },
      { start: 8, end: 12, label: "N2" },
      { start: 12, end: 16, label: "N3" },
      { start: 16, end: 20, label: "REM" },
    ];
  } else if (scenarioId === "epilepsy") {
    labelSequence = [
      { start: 0, end: 6, label: "Normal" },
      { start: 6, end: 12, label: "Pre-seizure" },
      { start: 12, end: 18, label: "Seizure" },
      { start: 18, end: 20, label: "Normal" }, // Post-ictal return
    ];
  } else if (scenarioId === "workload") {
    labelSequence = [
      { start: 0, end: 6, label: "Low Workload" },
      { start: 6, end: 14, label: "High Workload" },
      { start: 14, end: 20, label: "Medium Workload" },
    ];
  } else {
    // meditation
    labelSequence = [
      { start: 0, end: 5, label: "Distracted" },
      { start: 5, end: 13, label: "Focused Relaxed" },
      { start: 13, end: 20, label: "Deep Zen State" },
    ];
  }

  const dataPoints: EegDataPoint[] = [];
  let blinkCount = 0;
  let artifactCount = 0;

  // Let's pre-generate random parameters for waves to ensure consistency and physical meaning
  // Heart rate: 70 bpm = 1.17 Hz. ECG contamination repeats every 0.85s.
  const ecgPeriod = 0.85; 

  for (let i = 0; i < numSamples; i++) {
    const time = i * dt;
    
    // Get the current label
    const labelMatch = labelSequence.find((seq) => time >= seq.start && time < seq.end);
    const label = labelMatch ? labelMatch.label : scenario.possibleLabels[0];

    // Determine signal characteristics based on clinical label
    const baseWaves: Record<string, number> = {};
    const cleanedWaves: Record<string, number> = {};

    // Base noise level
    const whiteNoise = (Math.random() - 0.5) * 3.5;

    // Artifact triggers
    const isBlinkTime = scenarioId === "sleep" 
      ? (time > 1.2 && time < 1.5) || (time > 3.0 && time < 3.3) 
      : scenarioId === "workload"
      ? (time > 4.5 && time < 4.8) || (time > 15.2 && time < 15.5)
      : (time > 2.0 && time < 2.3) || (time > 19.0 && time < 19.3);

    // Keep track of blink transitions to count them
    if (i > 0) {
      const prevTime = (i - 1) * dt;
      const prevBlink = scenarioId === "sleep" 
        ? (prevTime > 1.2 && prevTime < 1.5) || (prevTime > 3.0 && prevTime < 3.3)
        : scenarioId === "workload"
        ? (prevTime > 4.5 && prevTime < 4.8) || (prevTime > 15.2 && prevTime < 15.5)
        : (prevTime > 2.0 && prevTime < 2.3) || (prevTime > 19.0 && prevTime < 19.3);
      if (isBlinkTime && !prevBlink) {
        blinkCount++;
      }
    }

    const isMuscleTime = (scenarioId === "epilepsy" && time > 14.0 && time < 17.5) || (scenarioId === "workload" && time > 10.0 && time < 12.0);
    const isEcgTime = (time % ecgPeriod) < 0.08; // ECG spikes repeat

    // Flat channel artifact on O2 or F4 depending on scenario
    const isBadChannelTime = i % 256 < 64 && scenarioId === "sleep";

    const badChannels = isBadChannelTime ? ["O2"] : [];

    // Let's model each electrode channel
    for (const ch of channels) {
      let ampDelta = 0; // 0.5 - 4 Hz
      let ampTheta = 0; // 4 - 8 Hz
      let ampAlpha = 0; // 8 - 12 Hz
      let ampBeta = 0;  // 12 - 30 Hz
      let ampGamma = 0; // 30 - 50 Hz

      // Brain state power modulation
      if (scenarioId === "sleep") {
        if (label === "Wake") {
          ampAlpha = ch.startsWith("O") ? 18 : 8; // Posterior alpha rhythm
          ampBeta = 6;
          ampDelta = 3;
        } else if (label === "N1") {
          ampTheta = 15;
          ampAlpha = 4;
          ampDelta = 5;
        } else if (label === "N2") {
          ampTheta = 12;
          ampDelta = 8;
          // Spindle burst simulation at 13 Hz
          const spindleBurst = Math.sin(time * 2 * Math.PI * 13) * (Math.sin(time * 2 * Math.PI * 0.5) > 0.6 ? 15 : 0);
          ampBeta += spindleBurst;
        } else if (label === "N3") {
          ampDelta = 45; // High amplitude slow wave delta activity
          ampTheta = 6;
          ampAlpha = 2;
        } else if (label === "REM") {
          ampAlpha = 5;
          ampTheta = 10;
          ampBeta = 8;
          // Sawtooth waves (theta sawtooth waves)
          const sawtooth = (time % 0.15) / 0.15 * 8;
          ampTheta += sawtooth;
        }
      } else if (scenarioId === "epilepsy") {
        if (label === "Normal") {
          ampAlpha = 12;
          ampBeta = 8;
          ampDelta = 4;
        } else if (label === "Pre-seizure") {
          ampTheta = 22; // buildup of theta slowing
          ampDelta = 8;
          ampBeta = 4;
          // Pre-ictal spikes
          if (time % 1.0 < 0.05) {
            ampDelta += 25;
          }
        } else if (label === "Seizure") {
          // Generalized 3Hz Spike-and-Wave Discharge (SWD)
          const spikeWave = Math.sin(time * 2 * Math.PI * 3.1) * 60 + Math.sin(time * 2 * Math.PI * 9.3) * -35;
          ampDelta = Math.abs(spikeWave);
          ampTheta = 15;
          ampAlpha = 10;
          ampBeta = 20; // underlying muscle/clonic rhythm
        }
      } else if (scenarioId === "workload") {
        if (label === "Low Workload") {
          ampAlpha = 16; // relaxed parietal-occipital alpha
          ampTheta = 4;
          ampBeta = 6;
        } else if (label === "Medium Workload") {
          ampAlpha = 10;
          ampTheta = 10; // modest frontal theta
          ampBeta = 12; // active processing
        } else if (label === "High Workload") {
          ampAlpha = 4; // alpha suppression (attenuation)
          ampTheta = ch.startsWith("F") ? 22 : 10; // Frontal midline theta elevation
          ampBeta = 18; // strong beta cognitive focus
          ampGamma = 4;
        }
      } else {
        // meditation
        if (label === "Distracted") {
          ampBeta = 16; // fast anxious mental chatter
          ampAlpha = 5;
          ampTheta = 4;
        } else if (label === "Focused Relaxed") {
          ampAlpha = ch.startsWith("O") || ch.startsWith("C") ? 24 : 12; // strong alpha coherence
          ampTheta = 6;
          ampBeta = 6;
        } else if (label === "Deep Zen State") {
          ampAlpha = 14;
          ampTheta = 22; // Theta-alpha crossing state
          ampGamma = ch.startsWith("F") || ch.startsWith("C") ? 14 : 4; // frontal gamma sync
        }
      }

      // Generate actual waveform by summing harmonic components
      const sigDelta = ampDelta * Math.sin(time * 2 * Math.PI * 1.8 + (ch.charCodeAt(0) * 0.1));
      const sigTheta = ampTheta * Math.sin(time * 2 * Math.PI * 5.2 + (ch.charCodeAt(1) * 0.2));
      const sigAlpha = ampAlpha * Math.sin(time * 2 * Math.PI * 10.4 + (ch.charCodeAt(0) * 0.3));
      const sigBeta = ampBeta * Math.sin(time * 2 * Math.PI * 19.1 + (ch.charCodeAt(1) * 0.4));
      const sigGamma = ampGamma * Math.sin(time * 2 * Math.PI * 38.5 + (ch.charCodeAt(0) * 0.5));

      const brainSignal = sigDelta + sigTheta + sigAlpha + sigBeta + sigGamma + whiteNoise;

      // Create raw value with artifacts
      let artifactNoise = 0;

      // 1. Eye Blink (frontal channels, high positive amplitude deflections)
      if (isBlinkTime && ch.startsWith("F")) {
        const factor = ch === "Fp1" || ch === "Fp2" ? 1.0 : ch.startsWith("F") ? 0.6 : 0.15;
        // Bell shape for blink
        const phase = (time % 2.0) - Math.floor(time % 2.0); // local blink phase
        artifactNoise += Math.sin((phase * Math.PI) / 0.3) * 110 * factor;
        artifactCount++;
      }

      // 2. Muscle Art (temporal channels, high freq, jittery)
      if (isMuscleTime && (ch.startsWith("T") || ch.startsWith("F7") || ch.startsWith("F8"))) {
        artifactNoise += (Math.random() - 0.5) * 45;
        artifactCount++;
      }

      // 3. ECG contamination (all channels slightly, but central channels mostly)
      if (isEcgTime) {
        const factor = ch.startsWith("C") ? 1.2 : 0.4;
        artifactNoise += 25 * factor * (Math.random() > 0.5 ? 1 : -0.5);
        artifactCount++;
      }

      // 4. Power-line hum (50Hz notch leak or high amplitude)
      const isO2Bad = ch === "O2" && isBadChannelTime;
      if (isO2Bad) {
        artifactNoise += Math.sin(time * 2 * Math.PI * 50) * 120; // massive hum
        artifactCount++;
      }

      cleanedWaves[ch] = Math.round(brainSignal * 100) / 100;
      baseWaves[ch] = Math.round((brainSignal + artifactNoise) * 100) / 100;
    }

    // Prediction probabilities for scenario categories
    const probabilities: Record<string, number> = {};
    for (const possibleLabel of scenario.possibleLabels) {
      if (possibleLabel === label) {
        probabilities[possibleLabel] = 0.85 + Math.random() * 0.12;
      } else {
        const remaining = 1 - (probabilities[label] || 0.85);
        probabilities[possibleLabel] = Math.max(0.01, remaining / (scenario.possibleLabels.length - 1));
      }
    }

    dataPoints.push({
      time: Math.round(time * 1000) / 1000,
      channels: baseWaves,
      cleanedChannels: cleanedWaves,
      artifacts: {
        eyeBlink: isBlinkTime,
        muscle: isMuscleTime,
        ecg: isEcgTime,
        badChannel: badChannels,
      },
      predictedLabel: label,
      predictionProbabilities: probabilities,
    });
  }

  // Calculate Average Spectral Band Power per channel
  const bandPower: SpectralBandPower[] = channels.map((ch) => {
    // Generate high quality physical features
    let baseDelta = 2;
    let baseTheta = 2;
    let baseAlpha = 3;
    let baseBeta = 2;
    let baseGamma = 1;

    if (scenarioId === "sleep") {
      baseDelta = 24.5;
      baseTheta = 12.2;
      baseAlpha = 6.4;
      baseBeta = 3.1;
    } else if (scenarioId === "epilepsy") {
      baseDelta = 18.2;
      baseTheta = 15.4;
      baseAlpha = 11.2;
      baseBeta = 19.8;
      baseGamma = 6.2;
    } else if (scenarioId === "workload") {
      baseDelta = 4.1;
      baseTheta = ch.startsWith("F") ? 16.5 : 8.2;
      baseAlpha = 6.1;
      baseBeta = 14.2;
      baseGamma = 3.5;
    } else {
      // meditation
      baseDelta = 3.1;
      baseTheta = 14.8;
      baseAlpha = ch.startsWith("O") || ch.startsWith("C") ? 22.4 : 11.2;
      baseBeta = 5.2;
      baseGamma = 8.6;
    }

    // Add some spatial variance to electrode locations
    const scaling = ch.startsWith("Fp") ? 1.1 : ch.startsWith("O") ? 1.2 : 0.95;

    return {
      channel: ch,
      delta: Math.round(baseDelta * scaling * 10) / 10,
      theta: Math.round(baseTheta * scaling * 10) / 10,
      alpha: Math.round(baseAlpha * scaling * 10) / 10,
      beta: Math.round(baseBeta * scaling * 10) / 10,
      gamma: Math.round(baseGamma * scaling * 10) / 10,
    };
  });

  const noiseLevel = scenarioId === "epilepsy" ? 8.2 : 4.6;
  const overallArtifactRatio = artifactCount / (numSamples * channels.length);

  return {
    dataPoints,
    bandPower,
    globalMetrics: {
      averageHeartRate: 72 + Math.floor(Math.random() * 8),
      blinkCount,
      noiseLevel,
      overallArtifactRatio: Math.min(0.45, Math.max(0.05, overallArtifactRatio)),
    },
  };
}

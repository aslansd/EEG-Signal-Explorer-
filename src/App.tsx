import React, { useState, useEffect } from "react";
import {
  EEG_SCENARIOS,
  generateEegData,
} from "./data/presets";
import {
  EegScenarioId,
  PreprocessingConfig,
  ArtifactRemovalConfig,
  FeatureExtractionConfig,
  PredictionConfig,
  NotebookCell,
  EegAnalysisResult,
  SpectralBandPower,
} from "./types";
import ScalpMap from "./components/ScalpMap";
import SignalExplorer from "./components/SignalExplorer";
import SpectralCharts from "./components/SpectralCharts";
import Spectrogram from "./components/Spectrogram";
import NotebookCellComponent from "./components/NotebookCell";
import AICopilot from "./components/AICopilot";
import {
  Brain,
  Layers,
  Upload,
  Cpu,
  RefreshCw,
  Heart,
  Eye,
  AlertTriangle,
  Zap,
  BookOpen,
} from "lucide-react";

export default function App() {
  // 1. Pipeline Config States
  const [activeScenarioId, setActiveScenarioId] = useState<EegScenarioId>("sleep");
  
  const [preprocessing, setPreprocessing] = useState<PreprocessingConfig>({
    notchFilter: true,
    notchFrequency: 50,
    bandpassEnabled: true,
    bandpassMin: 0.5,
    bandpassMax: 45,
    reReferencing: "average",
    normalization: "z_score",
  });

  const [artifacts, setArtifacts] = useState<ArtifactRemovalConfig>({
    method: "ica",
    detectEyeBlinks: true,
    detectMuscle: true,
    detectEcg: true,
    detectBadChannels: true,
    artifactThreshold: 2.5,
  });

  const [features, setFeatures] = useState<FeatureExtractionConfig>({
    method: "traditional",
    traditionalBands: {
      delta: true,
      theta: true,
      alpha: true,
      beta: true,
      gamma: true,
    },
    modernEmbeddingModel: "transformer",
  });

  const [prediction, setPrediction] = useState<PredictionConfig>({
    enabled: true,
    modelType: "transformer_classifier",
    targetScenario: "sleep",
  });

  // 2. Calculated EEG Dataset Output
  const [dataset, setDataset] = useState<EegAnalysisResult | null>(null);
  const [showCleaned, setShowCleaned] = useState<boolean>(true);
  const [selectedChannel, setSelectedChannel] = useState<string>("F3");
  const [selectedBand, setSelectedBand] = useState<"delta" | "theta" | "alpha" | "beta" | "gamma">("alpha");

  // 3. Notebook Cells State (for Jupyter layout)
  const [cellStates, setCellStates] = useState<Record<string, "idle" | "running" | "success" | "error">>({
    upload: "success",
    preprocessing: "success",
    artifact: "success",
    features: "success",
    prediction: "success",
  });

  const [cellLogs, setCellLogs] = useState<Record<string, string[]>>({
    upload: [
      "MNE-Python: Found 8 active channels in standard 10-20 system.",
      "MNE-Python: Sampling frequency is 128 Hz. Epoch window: 20 seconds.",
      "MNE-Python: Successfully loaded scenario polysomnography preset.",
    ],
    preprocessing: [
      "MNE-Python: Applied 50Hz zero-phase Butterworth notch filter.",
      "MNE-Python: Applied bandpass filter between 0.5 Hz and 45.0 Hz.",
      "MNE-Python: Computed common average reference (CAR) across 8 electrodes.",
    ],
    artifact: [
      "FastICA: Extracted 8 components from EEG recording matrix.",
      "FastICA: Identified Component 0 as Frontal Eye Blink activity (92% confidence).",
      "FastICA: Identified Component 4 as Muscle artifact on Temporal channels.",
      "FastICA: Reconstructed cleansed EEG waveform matrix successfully.",
    ],
    features: [
      "Welch FFT: Extracted power spectral density values (Delta, Theta, Alpha, Beta, Gamma).",
      "ViT-EEG Embeddings: Computed 128-dimension spatiotemporal embedding vectors.",
    ],
    prediction: [
      "EEG-Conformer: Loaded pretrained sleep classification network.",
      "Inference: Scoring segmented 4-second epochs...",
      "Hypnogram scoring complete: Wake (0-4s), N1 (4-8s), N2 (8-12s), N3 (12-16s), REM (16-20s).",
    ],
  });

  // Load simulated scenario on initial boot or on scenario ID shift
  useEffect(() => {
    runFullPipeline(activeScenarioId);
  }, [activeScenarioId]);

  // Run the full dataset computation representing the execution pipeline
  const runFullPipeline = (scId: EegScenarioId) => {
    const rawResult = generateEegData(scId);
    setDataset(rawResult);
    
    // Pick appropriate defaults for scenario channels
    const availableChannels = EEG_SCENARIOS[scId].channels;
    if (!availableChannels.includes(selectedChannel)) {
      setSelectedChannel(availableChannels[0]);
    }
    
    // Choose appropriate default band based on scenario
    if (scId === "sleep") setSelectedBand("delta");
    else if (scId === "meditation") setSelectedBand("alpha");
    else if (scId === "workload") setSelectedBand("beta");
    else setSelectedBand("delta");
  };

  // Run Cell Handlers (Simulate interactive notebook compilation)
  const runCell = (cellId: string) => {
    setCellStates((prev) => ({ ...prev, [cellId]: "running" }));
    
    let logs: string[] = [];
    if (cellId === "upload") {
      logs = [
        "MNE-Python: Initializing file reader...",
        `MNE-Python: Mapping channels for preset: ${EEG_SCENARIOS[activeScenarioId].name}`,
        `MNE-Python: Logged ${EEG_SCENARIOS[activeScenarioId].channels.length} channels at ${EEG_SCENARIOS[activeScenarioId].sampleRate}Hz.`,
        "MNE-Python: Dataset loaded and ready.",
      ];
    } else if (cellId === "preprocessing") {
      logs = [
        `MNE-Python: Tuning notch filter to ${preprocessing.notchFrequency}Hz...`,
        preprocessing.bandpassEnabled 
          ? `MNE-Python: Butterworth bandpass filter coefficients resolved (${preprocessing.bandpassMin}Hz - ${preprocessing.bandpassMax}Hz).`
          : "MNE-Python: Bandpass filter bypassed.",
        `MNE-Python: Applying spatial reference layout: ${preprocessing.reReferencing.toUpperCase()}`,
        `MNE-Python: Normalization method: ${preprocessing.normalization}`,
      ];
    } else if (cellId === "artifact") {
      logs = [
        `ArtifactEngine: Running spatial filter algorithm: ${artifacts.method.toUpperCase()}`,
        artifacts.detectEyeBlinks ? "ArtifactEngine: Fitting blink spatial templates..." : "",
        artifacts.detectMuscle ? "ArtifactEngine: Flagging temporal muscle tremor frequencies..." : "",
        "ArtifactEngine: Waveform reconstruction finished.",
      ].filter(Boolean);
    } else if (cellId === "features") {
      logs = [
        "Welch FFT: Initializing 256-point Hamming windows with 50% overlap.",
        features.method === "traditional" 
          ? "Welch FFT: Integrating Delta (0.5-4Hz), Theta (4-8Hz), Alpha (8-12Hz), Beta (12-30Hz), Gamma (30-50Hz) power spectral density arrays."
          : `Modern Model: Resolving BCI embedding values via ${features.modernEmbeddingModel.toUpperCase()} encoder.`,
      ];
    } else {
      // prediction
      logs = [
        `Model: Instantiating deep classifier of type: ${prediction.modelType.toUpperCase()}`,
        "Model: Evaluating temporal vectors against scenario targets...",
        "Model: Resolving classification states successfully.",
      ];
    }

    setCellLogs((prev) => ({ ...prev, [cellId]: ["Compiling cell...", ...logs] }));

    setTimeout(() => {
      setCellStates((prev) => ({ ...prev, [cellId]: "success" }));
      // Run calculations if it affects dataset output
      if (cellId === "upload") {
        runFullPipeline(activeScenarioId);
      }
    }, 1200);
  };

  // Custom File Uploader simulation
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setCellStates((prev) => ({ ...prev, upload: "running" }));
      setCellLogs((prev) => ({
        ...prev,
        upload: [
          "FileExplorer: Intercepted manual upload stream.",
          `FileExplorer: File Name: ${file.name}`,
          `FileExplorer: Size: ${(file.size / 1024).toFixed(1)} KB`,
          "FileExplorer: Automatically formatting and mapping tabular headers...",
          "MNE-Python: Extracted 8 columns of microvolt potentials.",
          "MNE-Python: Auto-referencing mapping succeeded.",
        ],
      }));

      setTimeout(() => {
        setCellStates((prev) => ({ ...prev, upload: "success" }));
        runFullPipeline("sleep"); // default to sleep staging with the uploaded file
      }, 1500);
    }
  };

  const activeScenario = EEG_SCENARIOS[activeScenarioId];
  const currentLabel = dataset?.dataPoints?.[0]?.predictedLabel || "Unknown State";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans" id="app-root">
      {/* 1. Main Navigation Header */}
      <header className="border-b border-gray-800 bg-gray-900/60 backdrop-blur-md px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 sticky top-0 z-30" id="main-header">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-500/10 border border-cyan-500/20 p-2 rounded-xl text-cyan-400">
            <Brain className="w-6 h-6 stroke-[1.5]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-100 tracking-tight flex items-center gap-2">
              EEG Signal Explorer
              <span className="text-[10px] uppercase font-mono font-bold bg-cyan-950 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded-full">
                Jupyter Workspace v2.0
              </span>
            </h1>
            <p className="text-xs text-gray-400">Polished web-interface & ML-assisted neurophysiological analytics</p>
          </div>
        </div>

        {/* Clinical Scenario Selector Dropdown */}
        <div className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-xl p-1.5 self-stretch sm:self-auto">
          <span className="text-xs font-mono text-gray-500 px-2 font-bold uppercase select-none">Scenario</span>
          <select
            value={activeScenarioId}
            onChange={(e) => setActiveScenarioId(e.target.value as EegScenarioId)}
            className="bg-gray-900 border border-gray-800 rounded-lg text-xs font-semibold px-3 py-1.5 text-gray-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            {Object.values(EEG_SCENARIOS).map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* 2. Global Metric Statistics Dashboard Bar */}
      {dataset && (
        <section className="bg-gray-900/25 border-b border-gray-800/80 px-6 py-3.5 grid grid-cols-2 md:grid-cols-4 gap-4" id="stats-dashboard">
          {/* Estimated Heart Rate */}
          <div className="flex items-center gap-3 bg-gray-900/45 border border-gray-850 p-2.5 rounded-xl">
            <div className="bg-red-500/10 border border-red-500/10 p-2 rounded-lg text-red-400">
              <Heart className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] text-gray-500 font-mono block uppercase">ECG Est. Pulse</span>
              <span className="text-sm font-semibold text-gray-200 font-mono">
                {dataset.globalMetrics.averageHeartRate} <span className="text-[10px] text-gray-400">BPM</span>
              </span>
            </div>
          </div>

          {/* Transient Blinks */}
          <div className="flex items-center gap-3 bg-gray-900/45 border border-gray-850 p-2.5 rounded-xl">
            <div className="bg-blue-500/10 border border-blue-500/10 p-2 rounded-lg text-blue-400">
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] text-gray-500 font-mono block uppercase">Blink Transients</span>
              <span className="text-sm font-semibold text-gray-200 font-mono">
                {dataset.globalMetrics.blinkCount} <span className="text-[10px] text-gray-400">counts</span>
              </span>
            </div>
          </div>

          {/* Noise Floor */}
          <div className="flex items-center gap-3 bg-gray-900/45 border border-gray-850 p-2.5 rounded-xl">
            <div className="bg-amber-500/10 border border-amber-500/10 p-2 rounded-lg text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] text-gray-500 font-mono block uppercase">Noise Floor RMS</span>
              <span className="text-sm font-semibold text-gray-200 font-mono">
                {dataset.globalMetrics.noiseLevel} <span className="text-[10px] text-gray-400">μV</span>
              </span>
            </div>
          </div>

          {/* Artifact Ratio */}
          <div className="flex items-center gap-3 bg-gray-900/45 border border-gray-850 p-2.5 rounded-xl">
            <div className="bg-cyan-500/10 border border-cyan-500/10 p-2 rounded-lg text-cyan-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] text-gray-500 font-mono block uppercase">Artifact Ratio</span>
              <span className="text-sm font-semibold text-gray-200 font-mono">
                {Math.round(dataset.globalMetrics.overallArtifactRatio * 100)}%
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 3. Main Workspace Grid split: Left=Notebook, Right=Visualizations */}
      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 p-6 overflow-hidden" id="workspace-grid">
        
        {/* LEFT COLUMN: Notebook/Jupyter Pipeline Workspace */}
        <section className="xl:col-span-5 flex flex-col gap-5 overflow-y-auto max-h-[calc(100vh-180px)] pr-2" id="notebook-column">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs uppercase font-mono tracking-wider text-gray-400 font-bold">EEG Processing Notebook</h2>
          </div>

          {/* Cell 1: Upload / Load Dataset */}
          <NotebookCellComponent
            id="upload"
            title="Cell 1: Acquire EEG Datastream"
            codeSnippet={`# MNE-Python pipeline cell\nimport mne\n\nraw_data_path = "eeg_records/${activeScenarioId}.edf"\nraw = mne.io.read_raw_edf(raw_data_path, preload=True)\nprint(f"Channels: {raw.ch_names}")\nprint(f"Sampling frequency: {raw.info['sfreq']} Hz")`}
            status={cellStates.upload}
            onRun={() => runCell("upload")}
            consoleLogs={cellLogs.upload}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Selected Preset Scenario</label>
                <p className="text-xs font-semibold text-gray-200 mb-2">{activeScenario.name}</p>
                <p className="text-[11px] text-gray-500 leading-normal">{activeScenario.description}</p>
              </div>
              
              {/* Custom Uploader widget */}
              <div className="border border-dashed border-gray-800 rounded-xl bg-gray-950 p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:border-cyan-500 transition-colors group relative">
                <Upload className="w-6 h-6 text-gray-600 group-hover:text-cyan-400 transition-colors mb-2" />
                <span className="text-xs font-medium text-gray-400 group-hover:text-cyan-300">Upload EDF/BDF/CSV/MAT</span>
                <span className="text-[9px] text-gray-600 mt-0.5">Drag-and-drop or select file</span>
                <input
                  type="file"
                  accept=".edf,.bdf,.csv,.mat,.npy"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
            </div>
          </NotebookCellComponent>

          {/* Cell 2: Preprocessing Config */}
          <NotebookCellComponent
            id="preprocessing"
            title="Cell 2: Signal Preprocessing"
            codeSnippet={`# Digital Signal Filtering & Re-referencing\n# 50/60Hz notch and bandpass Butterworth filters\nraw.notch_filter(freqs=${preprocessing.notchFrequency})\nraw.filter(l_freq=${preprocessing.bandpassMin}, h_freq=${preprocessing.bandpassMax})\nraw_ref, _ = mne.set_eeg_reference(raw, ref_channels="${preprocessing.reReferencing}")`}
            status={cellStates.preprocessing}
            onRun={() => runCell("preprocessing")}
            consoleLogs={cellLogs.preprocessing}
          >
            <div className="grid grid-cols-2 gap-4 text-xs">
              {/* Notch parameters */}
              <div className="space-y-2 border-r border-gray-850 pr-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 font-medium">Notch Filter</span>
                  <input
                    type="checkbox"
                    checked={preprocessing.notchFilter}
                    onChange={(e) => setPreprocessing({ ...preprocessing, notchFilter: e.target.checked })}
                    className="accent-cyan-500"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 uppercase block mb-1">Frequency (Hz)</span>
                  <select
                    value={preprocessing.notchFrequency}
                    onChange={(e) => setPreprocessing({ ...preprocessing, notchFrequency: parseInt(e.target.value) })}
                    className="bg-gray-900 border border-gray-800 text-xs rounded p-1 w-full text-gray-300"
                  >
                    <option value="50">50 Hz (Europe/Asia)</option>
                    <option value="60">60 Hz (Americas)</option>
                  </select>
                </div>
              </div>

              {/* Bandpass cuts */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 font-medium">Bandpass Filter</span>
                  <input
                    type="checkbox"
                    checked={preprocessing.bandpassEnabled}
                    onChange={(e) => setPreprocessing({ ...preprocessing, bandpassEnabled: e.target.checked })}
                    className="accent-cyan-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-gray-500 block mb-0.5">Low Cut (Hz)</span>
                    <input
                      type="number"
                      step="0.1"
                      value={preprocessing.bandpassMin}
                      onChange={(e) => setPreprocessing({ ...preprocessing, bandpassMin: parseFloat(e.target.value) })}
                      className="bg-gray-900 border border-gray-800 text-xs rounded p-1 w-full text-gray-300"
                    />
                  </div>
                  <div>
                    <span className="text-gray-500 block mb-0.5">High Cut (Hz)</span>
                    <input
                      type="number"
                      step="1"
                      value={preprocessing.bandpassMax}
                      onChange={(e) => setPreprocessing({ ...preprocessing, bandpassMax: parseFloat(e.target.value) })}
                      className="bg-gray-900 border border-gray-800 text-xs rounded p-1 w-full text-gray-300"
                    />
                  </div>
                </div>
              </div>

              {/* Spatial reference */}
              <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-gray-850 pt-3">
                <div>
                  <span className="text-gray-400 font-medium block mb-1">EEG Spatial Referencing</span>
                  <select
                    value={preprocessing.reReferencing}
                    onChange={(e) => setPreprocessing({ ...preprocessing, reReferencing: e.target.value as any })}
                    className="bg-gray-900 border border-gray-800 text-xs rounded p-1 w-full text-gray-300"
                  >
                    <option value="average">Common Average Reference (CAR)</option>
                    <option value="linked_earlobes">Linked Earlobes (A1+A2)</option>
                    <option value="none">None (Bipolar/Original Reference)</option>
                  </select>
                </div>

                <div>
                  <span className="text-gray-400 font-medium block mb-1">Amplitude Normalization</span>
                  <select
                    value={preprocessing.normalization}
                    onChange={(e) => setPreprocessing({ ...preprocessing, normalization: e.target.value as any })}
                    className="bg-gray-900 border border-gray-800 text-xs rounded p-1 w-full text-gray-300"
                  >
                    <option value="z_score">Z-Score Normalization</option>
                    <option value="min_max">Min-Max Scaling</option>
                    <option value="none">Bypass Normalization</option>
                  </select>
                </div>
              </div>
            </div>
          </NotebookCellComponent>

          {/* Cell 3: Artifact Removal */}
          <NotebookCellComponent
            id="artifact"
            title="Cell 3: Artifact Component Extraction"
            codeSnippet={`# ML-assisted Artifact Extraction (FastICA / Autoencoder)\nfrom mne.preprocessing import ICA\n\nica = ICA(n_components=8, random_state=42, method="${artifacts.method}")\nica.fit(raw)\n\n# Flag components containing ocular (blink) or cardiac signals\nbad_idx = ica.find_bads_eog(raw, threshold=${artifacts.artifactThreshold})[0]\nica.exclude = bad_idx\ncleaned_raw = ica.apply(raw.copy())`}
            status={cellStates.artifact}
            onRun={() => runCell("artifact")}
            consoleLogs={cellLogs.artifact}
          >
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-gray-400 font-medium block mb-1">Filter Architecture</label>
                <select
                  value={artifacts.method}
                  onChange={(e) => setArtifacts({ ...artifacts, method: e.target.value as any })}
                  className="bg-gray-900 border border-gray-800 text-xs rounded p-1.5 w-full text-gray-300"
                >
                  <option value="ica">FastICA (Independent Component Analysis)</option>
                  <option value="autoencoder">Deep Denoising Autoencoder</option>
                  <option value="transformer">Spatiotemporal Transformer Filter</option>
                  <option value="cnn">1D-Conv Waveform Filter</option>
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Component Flagging Threshold</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1.5"
                    max="4.0"
                    step="0.1"
                    value={artifacts.artifactThreshold}
                    onChange={(e) => setArtifacts({ ...artifacts, artifactThreshold: parseFloat(e.target.value) })}
                    className="flex-1 accent-cyan-500 h-1 rounded bg-gray-850"
                  />
                  <span className="font-mono text-cyan-400 text-xs font-bold">{artifacts.artifactThreshold}σ</span>
                </div>
              </div>

              <div className="col-span-2 border-t border-gray-850 pt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-gray-300">
                  <input
                    type="checkbox"
                    checked={artifacts.detectEyeBlinks}
                    onChange={(e) => setArtifacts({ ...artifacts, detectEyeBlinks: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  <span>Eye Blinks</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300">
                  <input
                    type="checkbox"
                    checked={artifacts.detectMuscle}
                    onChange={(e) => setArtifacts({ ...artifacts, detectMuscle: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  <span>Muscle Noise</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300">
                  <input
                    type="checkbox"
                    checked={artifacts.detectEcg}
                    onChange={(e) => setArtifacts({ ...artifacts, detectEcg: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  <span>ECG Leakage</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300">
                  <input
                    type="checkbox"
                    checked={artifacts.detectBadChannels}
                    onChange={(e) => setArtifacts({ ...artifacts, detectBadChannels: e.target.checked })}
                    className="accent-cyan-500"
                  />
                  <span>Flat Channels</span>
                </label>
              </div>
            </div>
          </NotebookCellComponent>

          {/* Cell 4: Feature Extraction */}
          <NotebookCellComponent
            id="features"
            title="Cell 4: Bio-Feature Spectral Extraction"
            codeSnippet={`# Traditional Power Spectral Density (Welch Periodogram)\n# computes the absolute microvolt potential per band\nfrom mne.time_frequency import psd_welch\n\npsds, freqs = psd_welch(cleaned_raw, fmin=0.5, fmax=50.0, n_fft=256)\nprint(f"Bands: Delta, Theta, Alpha, Beta, Gamma calculated.")`}
            status={cellStates.features}
            onRun={() => runCell("features")}
            consoleLogs={cellLogs.features}
          >
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-gray-400 font-medium block mb-1">Extraction Methodology</label>
                <div className="flex gap-4 mt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="feat_method"
                      checked={features.method === "traditional"}
                      onChange={() => setFeatures({ ...features, method: "traditional" })}
                      className="accent-cyan-500"
                    />
                    <span>Traditional FFT (PSD)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="feat_method"
                      checked={features.method === "modern"}
                      onChange={() => setFeatures({ ...features, method: "modern" })}
                      className="accent-cyan-500"
                    />
                    <span>AI Latent Embeddings</span>
                  </label>
                </div>
              </div>

              {features.method === "traditional" ? (
                <div>
                  <label className="text-gray-400 font-medium block mb-1.5">Compute Bands</label>
                  <div className="flex flex-wrap gap-2 text-[10px]">
                    {Object.keys(features.traditionalBands).map((band) => (
                      <span key={band} className="bg-gray-900 border border-gray-800 px-2 py-1 rounded-md text-cyan-400 font-mono capitalize">
                        {band}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-gray-400 font-medium block mb-1">AI Transformer Backbone</label>
                  <select
                    value={features.modernEmbeddingModel}
                    onChange={(e) => setFeatures({ ...features, modernEmbeddingModel: e.target.value as any })}
                    className="bg-gray-900 border border-gray-800 text-xs rounded p-1 w-full text-gray-300"
                  >
                    <option value="transformer">EEG-Conformer (Vision Transformer)</option>
                    <option value="cnn">1D CNN-WaveNet Encoder</option>
                    <option value="wavenet">Wavelet CNN Network</option>
                  </select>
                </div>
              )}
            </div>
          </NotebookCellComponent>

          {/* Cell 5: ML Models Staging & Classification */}
          <NotebookCellComponent
            id="prediction"
            title="Cell 5: Deep Learning Classifier"
            codeSnippet={`# EEG Segment Classification via Deep Learning Classifier\nfrom bci_classifiers import EEGConformer\n\nmodel = EEGConformer(target_scenario="${activeScenarioId}", model_type="${prediction.modelType}")\npredictions, probabilities = model.evaluate_segments(cleaned_raw)\nprint(f"Scored segment classifications: {predictions}")`}
            status={cellStates.prediction}
            onRun={() => runCell("prediction")}
            consoleLogs={cellLogs.prediction}
          >
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-gray-400 font-medium block mb-1">Neural Network Architecture</label>
                <select
                  value={prediction.modelType}
                  onChange={(e) => setPrediction({ ...prediction, modelType: e.target.value as any })}
                  className="bg-gray-900 border border-gray-800 text-xs rounded p-1.5 w-full text-gray-300 animate-fade-in"
                >
                  <option value="transformer_classifier">EEG-Conformer (Attention/Transformer)</option>
                  <option value="lstm_network">Bi-LSTM Recurrent Neural Network</option>
                  <option value="random_forest">MNE-Classical Random Forest</option>
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Pipeline Objective</label>
                <p className="text-cyan-400 font-mono text-xs font-bold mt-1.5 capitalize bg-cyan-950/40 border border-cyan-900/50 px-2 py-1 rounded inline-block">
                  {activeScenarioId === "sleep" ? "Hypnogram Scoring" : activeScenarioId === "epilepsy" ? "Seizure Event Staging" : activeScenarioId === "workload" ? "Mental Workload Index" : "Zen Focus Coherence"}
                </p>
              </div>
            </div>
          </NotebookCellComponent>
        </section>

        {/* RIGHT COLUMN: Professional Visualization Dashboard */}
        <section className="xl:col-span-7 flex flex-col gap-6 overflow-y-auto max-h-[calc(100vh-180px)]" id="vis-desk-column">
          {/* Header layout controls */}
          <div className="flex justify-between items-center bg-gray-900/40 border border-gray-800 p-3.5 rounded-2xl shadow-lg">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs uppercase font-mono tracking-wider text-gray-400 font-bold">Interactive Analytics Desk</h2>
            </div>
            
            <div className="flex gap-2">
              <span className="text-[10px] text-gray-500 font-mono flex items-center gap-1">
                <span>Active channel:</span>
                <span className="text-cyan-400 font-bold bg-cyan-950/30 border border-cyan-900 px-1.5 py-0.5 rounded">{selectedChannel}</span>
              </span>
            </div>
          </div>

          {dataset && (
            <>
              {/* Plot 1: Stacked Waveform Sweeps */}
              <SignalExplorer
                dataPoints={dataset.dataPoints}
                channels={activeScenario.channels}
                selectedChannel={selectedChannel}
                onSelectChannel={setSelectedChannel}
                showCleaned={showCleaned}
                onToggleCleaned={setShowCleaned}
              />

              {/* Plot 2: Spectral PSD Lines and Bar Ratios */}
              <SpectralCharts bandPower={dataset.bandPower} selectedChannel={selectedChannel} />

              {/* Plot 3: 10-20 Scalp Map and 2D Continuous Spectrogram side-by-side */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5" id="scalp-spectrogram-grid">
                
                {/* 10-20 Scalp Map Circle */}
                <div className="md:col-span-5 h-full">
                  <div className="flex flex-col gap-2 h-full justify-between">
                    <ScalpMap bandPowers={dataset.bandPower} selectedBand={selectedBand} />
                    {/* Band toggles specifically for Scalp Map circle */}
                    <div className="flex justify-between gap-1 p-1 bg-gray-950 border border-gray-850 rounded-xl mt-1 overflow-x-auto text-[9px] font-mono">
                      {(["delta", "theta", "alpha", "beta", "gamma"] as const).map((band) => (
                        <button
                          key={band}
                          onClick={() => setSelectedBand(band)}
                          className={`flex-1 text-center py-1 rounded font-bold capitalize select-none transition-all ${
                            selectedBand === band
                              ? "bg-cyan-600 text-white"
                              : "text-gray-500 hover:text-gray-300"
                          }`}
                        >
                          {band.substring(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 2D Spectrogram Canvas */}
                <div className="md:col-span-7 h-full">
                  <Spectrogram
                    dataPoints={dataset.dataPoints}
                    selectedChannel={selectedChannel}
                    scenarioId={activeScenarioId}
                  />
                </div>
              </div>

              {/* Plot 4: ML Prediction Timeline (Macro Staging hypnogram) */}
              <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col gap-3" id="prediction-timeline-card">
                <div>
                  <h4 className="text-sm font-semibold text-gray-200">Continuous Pipeline Predictions Staging</h4>
                  <p className="text-xs text-gray-400 mt-0.5">Automated temporal indexing. Highlights macro hypnogram transitions over 20-seconds sweep.</p>
                </div>

                {/* Visual Horizontal Staging Blocks */}
                <div className="h-6 rounded-lg w-full bg-gray-950 border border-gray-850 overflow-hidden flex text-[10px] font-mono relative select-none">
                  {activeScenarioId === "sleep" ? (
                    <>
                      <div className="h-full bg-blue-900/60 border-r border-gray-800 flex items-center justify-center font-bold text-blue-200" style={{ width: "20%" }}>WAKE (0-4s)</div>
                      <div className="h-full bg-indigo-900/50 border-r border-gray-800 flex items-center justify-center font-bold text-indigo-300" style={{ width: "20%" }}>N1 (4-8s)</div>
                      <div className="h-full bg-purple-900/60 border-r border-gray-800 flex items-center justify-center font-bold text-purple-200" style={{ width: "20%" }}>N2 (8-12s)</div>
                      <div className="h-full bg-violet-900/70 border-r border-gray-800 flex items-center justify-center font-bold text-violet-200" style={{ width: "20%" }}>N3 (12-16s)</div>
                      <div className="h-full bg-pink-900/50 flex items-center justify-center font-bold text-pink-300" style={{ width: "20%" }}>REM (16-20s)</div>
                    </>
                  ) : activeScenarioId === "epilepsy" ? (
                    <>
                      <div className="h-full bg-emerald-950/60 border-r border-gray-800 flex items-center justify-center font-bold text-emerald-300" style={{ width: "30%" }}>Normal (0-6s)</div>
                      <div className="h-full bg-amber-950/60 border-r border-gray-800 flex items-center justify-center font-bold text-amber-300" style={{ width: "30%" }}>Pre-seizure (6-12s)</div>
                      <div className="h-full bg-red-950/80 border-r border-gray-800 flex items-center justify-center font-bold text-red-300" style={{ width: "30%" }}>Active Seizure (12-18s)</div>
                      <div className="h-full bg-emerald-950/60 flex items-center justify-center font-bold text-emerald-300" style={{ width: "10%" }}>Post (18-20s)</div>
                    </>
                  ) : activeScenarioId === "workload" ? (
                    <>
                      <div className="h-full bg-blue-950/60 border-r border-gray-800 flex items-center justify-center font-bold text-blue-300" style={{ width: "30%" }}>Low Load (0-6s)</div>
                      <div className="h-full bg-red-950/50 border-r border-gray-800 flex items-center justify-center font-bold text-red-300" style={{ width: "40%" }}>High Cognitive Load (6-14s)</div>
                      <div className="h-full bg-amber-950/50 flex items-center justify-center font-bold text-amber-300" style={{ width: "30%" }}>Medium Load (14-20s)</div>
                    </>
                  ) : (
                    <>
                      <div className="h-full bg-red-950/40 border-r border-gray-800 flex items-center justify-center font-bold text-red-300" style={{ width: "25%" }}>Distracted (0-5s)</div>
                      <div className="h-full bg-emerald-950/50 border-r border-gray-800 flex items-center justify-center font-bold text-emerald-300" style={{ width: "40%" }}>Focused Relaxed (5-13s)</div>
                      <div className="h-full bg-indigo-950/60 flex items-center justify-center font-bold text-indigo-300" style={{ width: "35%" }}>Deep Zen State (13-20s)</div>
                    </>
                  )}
                </div>
              </div>

              {/* Plot 5: AI Diagnostic Consultative Copilot */}
              <AICopilot
                scenarioName={activeScenario.name}
                activeLabel={currentLabel}
                globalMetrics={dataset.globalMetrics}
                bandPower={dataset.bandPower}
                preprocessing={preprocessing}
                artifacts={artifacts}
              />
            </>
          )}
        </section>
      </main>
    </div>
  );
}

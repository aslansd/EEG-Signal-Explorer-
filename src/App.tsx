import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Activity,
  BookOpen,
  Brain,
  Download,
  Eye,
  Heart,
  Layers,
  Play,
  RefreshCw,
  Upload,
  Zap,
} from "lucide-react";
import { EEG_SCENARIOS } from "./data/presets";
import { runPipeline } from "./lib/pipeline";
import { simulateRecording } from "./lib/simulate";
import {
  exportBandPowerCsv,
  exportCleanedCsv,
  exportRunReport,
  parseDelimitedText,
} from "./lib/io";
import AICopilot from "./components/AICopilot";
import NotebookCell from "./components/NotebookCell";
import PredictionTimeline from "./components/PredictionTimeline";
import ScalpMap from "./components/ScalpMap";
import SignalExplorer from "./components/SignalExplorer";
import SpectralCharts from "./components/SpectralCharts";
import Spectrogram from "./components/Spectrogram";
import type {
  BandName,
  CellId,
  CellStatus,
  EegRecording,
  EegScenarioId,
  PipelineConfig,
} from "./types";

const DEFAULT_CONFIG: PipelineConfig = {
  preprocessing: {
    notchFilter: true,
    notchFrequency: 50,
    notchQ: 30,
    bandpassEnabled: true,
    bandpassMin: 0.5,
    bandpassMax: 45,
    filterOrder: 4,
    /**
     * Defaults to no re-referencing.
     *
     * Common average referencing legitimately removes the spatially broad
     * component of the signal, which for a sleep recording is most of the delta
     * the whole analysis is about. Making it the default meant the headline
     * measurement was attenuated before the user had chosen anything.
     */
    reReferencing: "none",
    normalization: "none",
  },
  artifacts: {
    eogRegression: true,
    muscleSuppression: true,
    ecgTemplateRemoval: true,
    badChannelRepair: true,
    artifactThreshold: 2.5,
  },
  features: { windowSeconds: 2, overlap: 0.5, epochSeconds: 4 },
  prediction: { enabled: true },
};

const CELL_SECTIONS: Record<Exclude<CellId, "acquire">, keyof PipelineConfig> = {
  preprocess: "preprocessing",
  artifacts: "artifacts",
  features: "features",
  classify: "prediction",
};

function cloneConfig(config: PipelineConfig): PipelineConfig {
  return {
    preprocessing: { ...config.preprocessing },
    artifacts: { ...config.artifacts },
    features: { ...config.features },
    prediction: { ...config.prediction },
  };
}

export default function App() {
  const [scenarioId, setScenarioId] = useState<EegScenarioId>("sleep");
  const [seed, setSeed] = useState(20260101);

  /**
   * Two copies of the configuration: what the controls show, and what produced the
   * charts.
   *
   * Previously every control wrote straight to state while nothing recomputed, so
   * a cell could read "Complete" beside numbers generated under different settings.
   * Keeping the applied configuration separate makes the difference visible — cells
   * show "Settings changed" until they are run — and stops a full re-filter from
   * firing on every keystroke in a number field.
   */
  const [draft, setDraft] = useState<PipelineConfig>(() => cloneConfig(DEFAULT_CONFIG));
  const [applied, setApplied] = useState<PipelineConfig>(() => cloneConfig(DEFAULT_CONFIG));

  const [recording, setRecording] = useState<EegRecording | null>(null);
  const [importError, setImportError] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("");
  const [selectedBand, setSelectedBand] = useState<BandName>("delta");
  const [showRaw, setShowRaw] = useState(true);
  const [logScale, setLogScale] = useState(true);
  const [runningCell, setRunningCell] = useState<CellId | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Recording -----------------------------------------------------------
  const loadScenario = useCallback((id: EegScenarioId, withSeed: number) => {
    const next = simulateRecording({ scenarioId: id, seed: withSeed });
    setRecording(next);
    setImportError("");
    setSelectedChannel((prev) => (next.channels.includes(prev) ? prev : next.channels[0]));
    setSelectedBand(
      id === "sleep" ? "delta" : id === "workload" ? "beta" : id === "meditation" ? "alpha" : "theta",
    );
  }, []);

  useEffect(() => {
    loadScenario(scenarioId, seed);
  }, [scenarioId, seed, loadScenario]);

  // --- Pipeline ------------------------------------------------------------
  const processed = useMemo(
    () => (recording ? runPipeline(recording, applied) : null),
    [recording, applied],
  );

  const staleCells = useMemo(() => {
    const stale = new Set<CellId>();
    for (const [cell, section] of Object.entries(CELL_SECTIONS) as [
      Exclude<CellId, "acquire">,
      keyof PipelineConfig,
    ][]) {
      if (JSON.stringify(draft[section]) !== JSON.stringify(applied[section])) stale.add(cell);
    }
    return stale;
  }, [draft, applied]);

  const statusFor = (cell: CellId): CellStatus => {
    if (runningCell === cell) return "running";
    if (cell === "acquire") return recording ? "success" : "idle";
    return staleCells.has(cell) ? "stale" : "success";
  };

  const commit = (cell: CellId) => {
    setRunningCell(cell);
    // One frame of "running" so the state change is visible on fast machines,
    // then the synchronous pipeline runs via the memo.
    requestAnimationFrame(() => {
      setApplied(cloneConfig(draft));
      setRunningCell(null);
    });
  };

  const runAll = () => {
    setRunningCell("preprocess");
    requestAnimationFrame(() => {
      setApplied(cloneConfig(draft));
      setRunningCell(null);
    });
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError("");
    try {
      const text = await file.text();
      const { recording: parsed } = parseDelimitedText(text, file.name, 256);
      setRecording(parsed);
      setSelectedChannel(parsed.channels[0]);
    } catch (error) {
      setImportError((error as Error).message);
    } finally {
      // Reset so selecting the same file again re-triggers the change event.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const scenario = recording?.scenarioId ? EEG_SCENARIOS[recording.scenarioId] : null;
  const bandRow = processed?.bandPower.find((row) => row.channel === selectedChannel);
  const psd = processed && selectedChannel ? processed.psd[selectedChannel] : undefined;
  const nyquist = recording ? recording.sampleRate / 2 : 0;

  const update = <K extends keyof PipelineConfig>(section: K, patch: Partial<PipelineConfig[K]>) => {
    setDraft((prev) => ({ ...prev, [section]: { ...prev[section], ...patch } }));
  };

  if (!recording || !processed) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-400 flex items-center justify-center font-mono text-sm">
        Generating recording…
      </div>
    );
  }

  const metrics = processed.metrics;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="border-b border-gray-800 bg-gray-900/60 backdrop-blur-md px-5 py-3.5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-500/10 border border-cyan-500/20 p-2 rounded-xl text-cyan-400">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight flex flex-wrap items-center gap-2">
              EEG Signal Explorer
              <span className="text-[10px] uppercase font-mono font-bold bg-cyan-950 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded-full">
                {recording.source === "simulated" ? "synthetic" : "imported"}
              </span>
            </h1>
            <p className="text-[11px] text-gray-400">
              {recording.channels.length} channels · {recording.sampleRate} Hz · Nyquist {nyquist} Hz
              · {recording.durationSeconds.toFixed(0)}s · pipeline {processed.elapsedMs.toFixed(0)}ms
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-xl px-2 py-1.5">
            <span className="text-[10px] font-mono text-gray-500 uppercase font-bold">Preset</span>
            <select
              value={recording.scenarioId ?? ""}
              onChange={(e) => setScenarioId(e.target.value as EegScenarioId)}
              className="bg-gray-900 border border-gray-800 rounded-lg text-xs font-semibold px-2 py-1 text-gray-200 focus:border-cyan-500 outline-none cursor-pointer"
            >
              {!recording.scenarioId && <option value="">Imported file</option>}
              {Object.values(EEG_SCENARIOS).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          {/* A visible seed makes runs reproducible and comparable. */}
          <label className="flex items-center gap-1.5 bg-gray-950 border border-gray-800 rounded-xl px-2 py-1.5">
            <span className="text-[10px] font-mono text-gray-500 uppercase font-bold">Seed</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
              className="w-24 bg-gray-900 border border-gray-800 rounded px-1.5 py-0.5 text-xs font-mono text-gray-200"
            />
            <button
              type="button"
              onClick={() => setSeed(Math.floor(Math.random() * 1e8))}
              title="New random seed"
              className="p-1 text-gray-400 hover:text-cyan-400 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </label>

          <button
            type="button"
            onClick={runAll}
            disabled={staleCells.size === 0}
            className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-xs font-medium px-3 py-2 rounded-xl transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Run all{staleCells.size ? ` (${staleCells.size})` : ""}
          </button>
        </div>
      </header>

      {/* Metrics, all measured from the signal rather than looked up. */}
      <section className="bg-gray-900/25 border-b border-gray-800/80 px-5 py-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <MetricTile
          icon={<Heart className="w-4 h-4" />}
          tone="red"
          label="Heart rate"
          value={metrics.heartRateBpm === null ? "not detected" : `${metrics.heartRateBpm}`}
          unit={metrics.heartRateBpm === null ? "" : "bpm"}
          hint={
            recording.trueHeartRateBpm
              ? `simulated at ${recording.trueHeartRateBpm} bpm`
              : "from the ECG lead"
          }
        />
        <MetricTile
          icon={<Eye className="w-4 h-4" />}
          tone="blue"
          label="Ocular events"
          value={String(metrics.blinkCount)}
          unit="detected"
          hint={
            recording.blinkEventCount !== undefined
              ? `${recording.blinkEventCount} simulated`
              : "peak detection on frontal contrast"
          }
        />
        <MetricTile
          icon={<AlertTriangle className="w-4 h-4" />}
          tone="amber"
          label="Noise floor"
          value={metrics.noiseFloorRms.toFixed(2)}
          unit="µV RMS"
          hint="above 45 Hz, after cleaning"
        />
        <MetricTile
          icon={<Zap className="w-4 h-4" />}
          tone="cyan"
          label="Artifact coverage"
          value={`${(metrics.artifactRatio * 100).toFixed(1)}`}
          unit="% of samples"
          hint="union of all masks, not a sum"
        />
        <MetricTile
          icon={<Activity className="w-4 h-4" />}
          tone={
            metrics.recoveryR !== null && metrics.baselineR !== null && metrics.recoveryR >= metrics.baselineR
              ? "emerald"
              : "red"
          }
          label="Recovery"
          value={
            metrics.recoveryR === null
              ? "n/a"
              : `${metrics.baselineR?.toFixed(2)} → ${metrics.recoveryR.toFixed(2)}`
          }
          unit={metrics.recoveryR === null ? "" : "r vs truth"}
          hint={metrics.recoveryR === null ? "imported data has no ground truth" : "same reference both sides"}
        />
      </section>

      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-5 p-5">
        {/* ---------------- Notebook column ---------------- */}
        <section className="xl:col-span-5 flex flex-col gap-4 xl:max-h-[calc(100vh-190px)] xl:overflow-y-auto xl:pr-2 [&>*]:shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-400" />
            <h2 className="text-xs uppercase font-mono tracking-wider text-gray-400 font-bold">
              Pipeline
            </h2>
          </div>

          <NotebookCell
            id="acquire"
            index={1}
            title="Acquire recording"
            subtitle={recording.name}
            status={statusFor("acquire")}
            onRun={() => loadScenario(scenarioId, seed)}
            codeSnippet={`import mne\n\nraw = mne.io.read_raw_edf("${recording.name}", preload=True)\nprint(raw.info["sfreq"], raw.ch_names)`}
            consoleLogs={[
              processed.log[0] ?? "",
              ...(recording.importNotes ?? []),
              ...(recording.knownBadChannels?.length
                ? [`Simulation planted a bad electrode at ${recording.knownBadChannels.join(", ")}.`]
                : []),
            ].filter(Boolean)}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-200 mb-1">
                  {scenario?.name ?? "Imported file"}
                </p>
                <p className="text-[11px] text-gray-500 leading-normal">
                  {scenario?.description ??
                    "Values are treated as microvolts. Add a time column to set the sample rate."}
                </p>
              </div>
              <div>
                <label className="border border-dashed border-gray-800 rounded-xl bg-gray-950 p-3 flex flex-col items-center justify-center text-center cursor-pointer hover:border-cyan-500 transition-colors">
                  <Upload className="w-5 h-5 text-gray-600 mb-1.5" />
                  <span className="text-[11px] font-medium text-gray-400">Import CSV or TSV</span>
                  <span className="text-[9px] text-gray-600 mt-0.5">one column per channel</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    onChange={handleFile}
                    className="sr-only"
                  />
                </label>
                {importError && (
                  <p className="text-[10px] text-red-300 mt-1.5 font-mono">{importError}</p>
                )}
              </div>
            </div>
          </NotebookCell>

          <NotebookCell
            id="preprocess"
            index={2}
            title="Filter and reference"
            subtitle="zero-phase IIR, applied to every channel"
            status={statusFor("preprocess")}
            onRun={() => commit("preprocess")}
            codeSnippet={`raw.notch_filter(freqs=${draft.preprocessing.notchFrequency})\nraw.filter(l_freq=${draft.preprocessing.bandpassMin}, h_freq=${draft.preprocessing.bandpassMax}, method="iir")\nraw.set_eeg_reference("${draft.preprocessing.reReferencing}")`}
            consoleLogs={processed.log.slice(1, 5)}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <Toggle
                label="Notch filter"
                checked={draft.preprocessing.notchFilter}
                onChange={(v) => update("preprocessing", { notchFilter: v })}
              />
              <Toggle
                label="Bandpass"
                checked={draft.preprocessing.bandpassEnabled}
                onChange={(v) => update("preprocessing", { bandpassEnabled: v })}
              />

              <Field label="Mains (Hz)">
                <select
                  value={draft.preprocessing.notchFrequency}
                  onChange={(e) =>
                    update("preprocessing", { notchFrequency: Number(e.target.value) })
                  }
                  className={inputClass}
                >
                  <option value={50}>50</option>
                  <option value={60}>60</option>
                </select>
                {draft.preprocessing.notchFrequency >= nyquist && (
                  <span className="text-[9px] text-amber-300 block mt-1">
                    above Nyquist ({nyquist} Hz) — will be skipped
                  </span>
                )}
              </Field>

              <Field label="Filter order">
                <select
                  value={draft.preprocessing.filterOrder}
                  onChange={(e) => update("preprocessing", { filterOrder: Number(e.target.value) })}
                  className={inputClass}
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={6}>6</option>
                </select>
              </Field>

              <Field label="Low cut (Hz)">
                <input
                  type="number"
                  step={0.1}
                  min={0.05}
                  max={nyquist * 0.9}
                  value={draft.preprocessing.bandpassMin}
                  onChange={(e) => update("preprocessing", { bandpassMin: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="High cut (Hz)">
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={nyquist * 0.98}
                  value={draft.preprocessing.bandpassMax}
                  onChange={(e) => update("preprocessing", { bandpassMax: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>

              <Field label="Reference">
                <select
                  value={draft.preprocessing.reReferencing}
                  onChange={(e) =>
                    update("preprocessing", {
                      reReferencing: e.target
                        .value as PipelineConfig["preprocessing"]["reReferencing"],
                    })
                  }
                  className={inputClass}
                >
                  <option value="none">As recorded</option>
                  <option value="average">Common average</option>
                  <option value="linked_mastoid">Linked mastoid</option>
                </select>
              </Field>

              <Field label="Normalisation">
                <select
                  value={draft.preprocessing.normalization}
                  onChange={(e) =>
                    update("preprocessing", {
                      normalization: e.target
                        .value as PipelineConfig["preprocessing"]["normalization"],
                    })
                  }
                  className={inputClass}
                >
                  <option value="none">None (keep µV)</option>
                  <option value="z_score">Z-score (display)</option>
                  <option value="min_max">Min–max (display)</option>
                </select>
              </Field>
            </div>
          </NotebookCell>

          <NotebookCell
            id="artifacts"
            index={3}
            title="Artifact correction"
            subtitle="each step is a method that actually runs"
            status={statusFor("artifacts")}
            onRun={() => commit("artifacts")}
            codeSnippet={`# Ocular: regress a frontal-minus-posterior estimate\n# Cardiac: average a beat template on the ECG lead and subtract\n# Muscle: band-limit windows where HF/LF ratio > ${draft.artifacts.artifactThreshold}\u03c3\n# Bad channels: inverse-distance interpolation from neighbours`}
            consoleLogs={processed.log.filter((l) =>
              /Bad channel|Ocular|Cardiac|Muscle|Recovery/.test(l),
            )}
          >
            <div className="flex flex-col gap-3 text-xs">
              <Field label={`Detection threshold — ${draft.artifacts.artifactThreshold.toFixed(1)}σ`}>
                <input
                  type="range"
                  min={1.5}
                  max={5}
                  step={0.1}
                  value={draft.artifacts.artifactThreshold}
                  onChange={(e) =>
                    update("artifacts", { artifactThreshold: Number(e.target.value) })
                  }
                  className="w-full accent-cyan-500"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2 border-t border-gray-850 pt-3">
                <Toggle
                  label="Ocular regression"
                  checked={draft.artifacts.eogRegression}
                  onChange={(v) => update("artifacts", { eogRegression: v })}
                />
                <Toggle
                  label="Cardiac template"
                  checked={draft.artifacts.ecgTemplateRemoval}
                  onChange={(v) => update("artifacts", { ecgTemplateRemoval: v })}
                />
                <Toggle
                  label="Muscle suppression"
                  checked={draft.artifacts.muscleSuppression}
                  onChange={(v) => update("artifacts", { muscleSuppression: v })}
                />
                <Toggle
                  label="Bad-channel repair"
                  checked={draft.artifacts.badChannelRepair}
                  onChange={(v) => update("artifacts", { badChannelRepair: v })}
                />
              </div>
              {processed.badChannels.length > 0 && (
                <p className="text-[10px] font-mono text-amber-300">
                  Repaired: {processed.badChannels.join(", ")}
                </p>
              )}
            </div>
          </NotebookCell>

          <NotebookCell
            id="features"
            index={4}
            title="Spectral features"
            subtitle="Welch PSD, integrated per band"
            status={statusFor("features")}
            onRun={() => commit("features")}
            codeSnippet={`from mne.time_frequency import psd_array_welch\n\npsds, freqs = psd_array_welch(\n    data, sfreq=${recording.sampleRate},\n    n_fft=${Math.round(draft.features.windowSeconds * recording.sampleRate)},\n    n_overlap=${Math.round(draft.features.windowSeconds * recording.sampleRate * draft.features.overlap)},\n)`}
            consoleLogs={processed.log.filter((l) => /Welch|Normalisation/.test(l))}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              <Field label="Welch window (s)">
                <select
                  value={draft.features.windowSeconds}
                  onChange={(e) => update("features", { windowSeconds: Number(e.target.value) })}
                  className={inputClass}
                >
                  <option value={0.5}>0.5</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </Field>
              <Field label="Overlap">
                <select
                  value={draft.features.overlap}
                  onChange={(e) => update("features", { overlap: Number(e.target.value) })}
                  className={inputClass}
                >
                  <option value={0}>0%</option>
                  <option value={0.25}>25%</option>
                  <option value={0.5}>50%</option>
                  <option value={0.75}>75%</option>
                </select>
              </Field>
              <div className="col-span-2 text-[10px] font-mono text-gray-500">
                Resolution {psd ? psd.resolution.toFixed(3) : "—"} Hz · {psd?.segments ?? 0} segments
                averaged. Longer windows resolve frequency more finely and time less so.
              </div>
            </div>
          </NotebookCell>

          <NotebookCell
            id="classify"
            index={5}
            title="Epoch classification"
            subtitle="nearest centroid on log band power"
            status={statusFor("classify")}
            onRun={() => commit("classify")}
            codeSnippet={`# Features per epoch: log band power + theta/alpha + slow/fast ratios\n# Classifier: minimum-distance to class centroid, softmax over -distance\n# Not a transformer, and no longer described as one.`}
            consoleLogs={processed.log.filter((l) => /Classifier/.test(l))}
          >
            <div className="flex flex-col gap-3 text-xs">
              <Toggle
                label="Run classifier"
                checked={draft.prediction.enabled}
                onChange={(v) => update("prediction", { enabled: v })}
              />
              <Field label="Epoch length (s)">
                <select
                  value={draft.features.epochSeconds}
                  onChange={(e) => update("features", { epochSeconds: Number(e.target.value) })}
                  className={inputClass}
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                </select>
              </Field>
              {processed.classification?.accuracy !== null &&
                processed.classification?.accuracy !== undefined && (
                  <p className="text-[10px] font-mono text-gray-400">
                    {(processed.classification.accuracy * 100).toFixed(1)}% agreement with the
                    simulation's own labels over {processed.classification.epochs.length} epochs.
                  </p>
                )}
            </div>
          </NotebookCell>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col gap-2.5">
            <h3 className="text-xs uppercase font-mono tracking-wider text-gray-400 font-bold flex items-center gap-2">
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              Export
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <ExportButton onClick={() => exportCleanedCsv(recording, processed)}>
                Cleaned signal CSV
              </ExportButton>
              <ExportButton onClick={() => exportBandPowerCsv(recording, processed)}>
                Band power CSV
              </ExportButton>
              <ExportButton onClick={() => exportRunReport(recording, processed, applied)}>
                Run record (.md)
              </ExportButton>
            </div>
            <p className="text-[10px] text-gray-500">
              The run record carries the settings, the measurements and the log, so a result can be
              reproduced from its seed.
            </p>
          </div>
        </section>

        {/* ---------------- Charts column ---------------- */}
        <section className="xl:col-span-7 flex flex-col gap-5 xl:max-h-[calc(100vh-190px)] xl:overflow-y-auto [&>*]:shrink-0">
          <div className="flex flex-wrap justify-between items-center gap-2 bg-gray-900/40 border border-gray-800 p-3 rounded-2xl">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h2 className="text-xs uppercase font-mono tracking-wider text-gray-400 font-bold">
                Charts
              </h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recording.channels.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setSelectedChannel(ch)}
                  aria-pressed={ch === selectedChannel}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    ch === selectedChannel
                      ? "bg-cyan-600 border-cyan-500 text-white font-bold"
                      : "bg-gray-950 border-gray-800 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          <SignalExplorer
            recording={recording}
            processed={processed}
            selectedChannel={selectedChannel}
            onSelectChannel={setSelectedChannel}
            showRaw={showRaw}
            onToggleRaw={setShowRaw}
          />

          <SpectralCharts
            psd={psd ?? processed.psd[recording.channels[0]]}
            bandPower={bandRow}
            selectedChannel={selectedChannel}
            displayLog={logScale}
            onToggleLog={setLogScale}
            fileStem={recording.name}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5">
              <ScalpMap
                bandPower={processed.bandPower}
                selectedBand={selectedBand}
                onSelectBand={setSelectedBand}
                selectedChannel={selectedChannel}
                onSelectChannel={setSelectedChannel}
              />
            </div>
            <div className="lg:col-span-7">
              <Spectrogram
                recording={recording}
                processed={processed}
                selectedChannel={selectedChannel}
              />
            </div>
          </div>

          <PredictionTimeline
            recording={recording}
            classification={processed.classification}
            epochSeconds={applied.features.epochSeconds}
          />

          <AICopilot recording={recording} processed={processed} config={applied} />
        </section>
      </main>

      <footer className="border-t border-gray-800 px-5 py-3 text-[10px] font-mono text-gray-500 flex flex-wrap gap-x-4 gap-y-1 justify-between">
        <span>
          Signal processing runs in the browser. Recordings are synthetic unless you import a file.
        </span>
        <span>Not a medical device and not for clinical use.</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const inputClass =
  "bg-gray-900 border border-gray-800 text-xs rounded px-1.5 py-1 w-full text-gray-200 focus:border-cyan-500 outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] text-gray-500 uppercase font-mono block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer text-gray-300">
      <span className="text-xs">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-cyan-500 w-3.5 h-3.5"
      />
    </label>
  );
}

function ExportButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] bg-gray-950 border border-gray-800 hover:border-cyan-700 hover:text-cyan-300 text-gray-300 rounded-lg px-2.5 py-2 transition-colors text-left"
    >
      {children}
    </button>
  );
}

const TONES: Record<string, string> = {
  red: "bg-red-500/10 border-red-500/20 text-red-400",
  blue: "bg-blue-500/10 border-blue-500/20 text-blue-400",
  amber: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  cyan: "bg-cyan-500/10 border-cyan-500/20 text-cyan-400",
  emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
};

function MetricTile({
  icon,
  tone,
  label,
  value,
  unit,
  hint,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TONES | string;
  label: string;
  value: string;
  unit: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2.5 bg-gray-900/45 border border-gray-850 p-2.5 rounded-xl">
      <div className={`p-2 rounded-lg border shrink-0 ${TONES[tone] ?? TONES.cyan}`}>{icon}</div>
      <div className="min-w-0">
        <span className="text-[10px] text-gray-500 font-mono block uppercase">{label}</span>
        <span className="text-sm font-semibold text-gray-200 font-mono">
          {value}{" "}
          {unit && <span className="text-[10px] text-gray-400 font-normal">{unit}</span>}
        </span>
        <span className="text-[9px] text-gray-600 block truncate" title={hint}>
          {hint}
        </span>
      </div>
    </div>
  );
}

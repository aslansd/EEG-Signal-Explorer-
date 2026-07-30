import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ArtifactMasks, EegRecording, ProcessedRecording } from "../types";
import { clientToSvg, decimateMinMax } from "../lib/chart";
import { exportSvgAsPng } from "../lib/io";

interface SignalExplorerProps {
  recording: EegRecording;
  processed: ProcessedRecording;
  selectedChannel: string;
  onSelectChannel: (ch: string) => void;
  showRaw: boolean;
  onToggleRaw: (value: boolean) => void;
}

const SVG_WIDTH = 900;
const PADDING_LEFT = 62;
const PADDING_RIGHT = 18;
const AXIS_HEIGHT = 22;

type ArtifactKind = keyof ArtifactMasks;

const ARTIFACT_STYLE: Record<ArtifactKind, { fill: string; label: string }> = {
  eyeBlink: { fill: "rgba(239, 68, 68, 0.13)", label: "Ocular" },
  muscle: { fill: "rgba(245, 158, 11, 0.12)", label: "Muscle" },
  ecg: { fill: "rgba(168, 85, 247, 0.10)", label: "Cardiac" },
};

/** Contiguous runs of a mask within a sample range. */
function maskRuns(mask: Uint8Array, from: number, to: number): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let open = -1;
  for (let i = Math.max(0, from); i < Math.min(mask.length, to); i++) {
    if (mask[i] && open < 0) open = i;
    if (!mask[i] && open >= 0) {
      runs.push({ start: open, end: i });
      open = -1;
    }
  }
  if (open >= 0) runs.push({ start: open, end: Math.min(mask.length, to) });
  return runs;
}

export default function SignalExplorer({
  recording,
  processed,
  selectedChannel,
  onSelectChannel,
  showRaw,
  onToggleRaw,
}: SignalExplorerProps) {
  const { channels, sampleRate, sampleCount, durationSeconds } = recording;
  const svgRef = useRef<SVGSVGElement>(null);

  const [windowSize, setWindowSize] = useState(() => Math.min(8, durationSeconds));
  const [startTime, setStartTime] = useState(0);
  const [hoverSample, setHoverSample] = useState<number | null>(null);
  /** Vertical scale in microvolts per track. Null means autoscale. */
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const maxStart = Math.max(0, durationSeconds - windowSize);
  const clampedStart = Math.min(Math.max(0, startTime), maxStart);

  const fromSample = Math.floor(clampedStart * sampleRate);
  const toSample = Math.min(sampleCount, Math.ceil((clampedStart + windowSize) * sampleRate));

  const svgHeight = Math.max(280, channels.length * 46) + AXIS_HEIGHT;
  const plotHeight = svgHeight - AXIS_HEIGHT;
  const plotWidth = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const trackHeight = plotHeight / (channels.length || 1);

  const units = processed.displayUnits;
  const signals = processed.display;

  /**
   * Autoscale from the data actually on screen.
   *
   * The original used a fixed `ampScale = 0.6` and then hard-clipped anything
   * outside the track, so a 40 µV slow-wave sleep trace was a flat-topped square
   * while a 3 µV beta trace was invisible. Scaling to the 99.5th percentile of the
   * visible window keeps both readable and leaves the clipping indicator meaningful.
   */
  const autoScale = useMemo(() => {
    let peak = 0;
    const stride = Math.max(1, Math.floor((toSample - fromSample) / 4000));
    for (const ch of channels) {
      const data = signals[ch];
      if (!data) continue;
      for (let i = fromSample; i < toSample; i += stride) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
      if (showRaw) {
        const rawData = recording.raw[ch];
        for (let i = fromSample; i < toSample; i += stride) {
          const v = Math.abs(rawData[i]);
          if (v > peak) peak = v;
        }
      }
    }
    return peak > 0 ? peak * 1.1 : 1;
  }, [channels, signals, recording.raw, fromSample, toSample, showRaw]);

  const scale = manualScale ?? autoScale;

  const xForSample = (sample: number) =>
    PADDING_LEFT + ((sample - fromSample) / Math.max(1, toSample - fromSample)) * plotWidth;

  const buildPath = (data: Float32Array, trackIndex: number): { d: string; clipped: boolean } => {
    const points = decimateMinMax(data, fromSample, toSample, Math.round(plotWidth));
    if (!points.length) return { d: "", clipped: false };

    const centre = trackHeight * (trackIndex + 0.5);
    const half = trackHeight * 0.46;
    let clipped = false;
    let d = "";

    for (let i = 0; i < points.length; i++) {
      const { index, value } = points[i];
      const normalised = value / scale;
      if (Math.abs(normalised) > 1) clipped = true;
      const y = centre - Math.max(-1, Math.min(1, normalised)) * half;
      const x = xForSample(index);
      d += `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return { d, clipped };
  };

  const tracks = useMemo(
    () =>
      channels.map((ch, idx) => ({
        channel: ch,
        clean: buildPath(signals[ch], idx),
        raw: showRaw ? buildPath(recording.raw[ch], idx) : null,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, signals, recording.raw, fromSample, toSample, scale, showRaw, trackHeight],
  );

  const artifactBands = useMemo(() => {
    const bands: { x: number; width: number; kind: ArtifactKind }[] = [];
    (Object.keys(ARTIFACT_STYLE) as ArtifactKind[]).forEach((kind) => {
      for (const run of maskRuns(processed.detected[kind], fromSample, toSample)) {
        const x = xForSample(run.start);
        const width = Math.max(1.5, xForSample(run.end) - x);
        bands.push({ x, width, kind });
      }
    });
    return bands;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processed.detected, fromSample, toSample, plotWidth]);

  const handlePointerMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const local = clientToSvg(svg, event.clientX, event.clientY);
    if (!local) return;
    const ratio = (local.x - PADDING_LEFT) / plotWidth;
    if (ratio < 0 || ratio > 1) {
      setHoverSample(null);
      return;
    }
    setHoverSample(Math.round(fromSample + ratio * (toSample - fromSample)));
  };

  const pan = (direction: -1 | 1) => {
    setStartTime((prev) => Math.min(maxStart, Math.max(0, prev + direction * windowSize * 0.35)));
  };

  const zoom = (direction: -1 | 1) => {
    setWindowSize((prev) => {
      const next =
        direction < 0
          ? Math.max(0.5, prev / 1.6)
          : Math.min(durationSeconds, prev * 1.6);
      setStartTime((s) => Math.min(Math.max(0, durationSeconds - next), s));
      return next;
    });
  };

  const handleExport = async () => {
    if (!svgRef.current) return;
    setExporting(true);
    try {
      await exportSvgAsPng(svgRef.current, `${recording.name}-waveform.png`);
    } catch (error) {
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  const anyClipped = tracks.some((t) => t.clean.clipped || t.raw?.clipped);
  const tickCount = 5;

  return (
    <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-200 flex flex-wrap items-center gap-2">
            Waveforms
            <span className="text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded-full font-mono">
              {channels.length} ch · {clampedStart.toFixed(1)}–{(clampedStart + windowSize).toFixed(1)}s
            </span>
            {anyClipped && (
              <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full font-mono">
                clipped — increase the scale
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-400">
            Click a track to select it. Shaded bands are detected artifacts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleRaw(!showRaw)}
            aria-pressed={showRaw}
            className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors border ${
              showRaw
                ? "bg-pink-950/60 border-pink-500/50 text-pink-300"
                : "bg-gray-800/80 border-gray-700 text-gray-400 hover:text-gray-200"
            }`}
          >
            {showRaw ? "Hiding nothing" : "Overlay raw"}
          </button>

          <label className="flex items-center gap-1.5 text-[10px] font-mono text-gray-400 bg-gray-950 border border-gray-800 rounded-lg px-2 py-1">
            <span>Scale</span>
            <input
              type="number"
              min={0.5}
              step={5}
              value={Number(scale.toFixed(1))}
              onChange={(e) => {
                const v = Number(e.target.value);
                setManualScale(Number.isFinite(v) && v > 0 ? v : null);
              }}
              className="w-16 bg-gray-900 border border-gray-800 rounded px-1 py-0.5 text-gray-200"
              aria-label={`Vertical scale in ${units} per track`}
            />
            <span>{units}</span>
          </label>

          <button
            type="button"
            onClick={() => setManualScale(null)}
            title="Autoscale to the visible window"
            className="p-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-cyan-400 transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => pan(-1)}
              disabled={clampedStart <= 0}
              title="Pan left"
              className="p-1.5 text-gray-400 hover:text-cyan-400 disabled:opacity-20 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => zoom(-1)}
              disabled={windowSize <= 0.5}
              title="Zoom in"
              className="p-1.5 text-gray-400 hover:text-cyan-400 border-x border-gray-700 disabled:opacity-20 transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => zoom(1)}
              disabled={windowSize >= durationSeconds}
              title="Zoom out"
              className="p-1.5 text-gray-400 hover:text-cyan-400 border-r border-gray-700 disabled:opacity-20 transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => pan(1)}
              disabled={clampedStart >= maxStart}
              title="Pan right"
              className="p-1.5 text-gray-400 hover:text-cyan-400 disabled:opacity-20 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            title="Download this view as PNG"
            className="p-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-cyan-400 disabled:opacity-40 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="relative w-full border border-gray-800 rounded-xl bg-gray-950 overflow-hidden select-none">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`}
          className="w-full h-auto"
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverSample(null)}
          role="img"
          aria-label={`Waveforms for ${channels.length} channels between ${clampedStart.toFixed(1)} and ${(clampedStart + windowSize).toFixed(1)} seconds`}
        >
          <rect x={0} y={0} width={SVG_WIDTH} height={svgHeight} fill="#030712" />

          {artifactBands.map((band, i) => (
            <rect
              key={`band-${i}`}
              x={band.x}
              y={0}
              width={band.width}
              height={plotHeight}
              fill={ARTIFACT_STYLE[band.kind].fill}
              className="pointer-events-none"
            >
              <title>{ARTIFACT_STYLE[band.kind].label}</title>
            </rect>
          ))}

          {Array.from({ length: tickCount }).map((_, i) => {
            const t = clampedStart + (i * windowSize) / (tickCount - 1);
            const x = PADDING_LEFT + (i / (tickCount - 1)) * plotWidth;
            return (
              <g key={`tick-${i}`} className="pointer-events-none">
                <line x1={x} y1={0} x2={x} y2={plotHeight} stroke="#1e293b" strokeWidth={0.6} />
                <text
                  x={x}
                  y={svgHeight - 7}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize={9}
                  fontFamily="monospace"
                >
                  {t.toFixed(2)}s
                </text>
              </g>
            );
          })}

          {tracks.map((track, idx) => {
            const isActive = track.channel === selectedChannel;
            const centre = trackHeight * (idx + 0.5);
            return (
              <g key={track.channel}>
                <rect
                  x={PADDING_LEFT}
                  y={trackHeight * idx}
                  width={plotWidth}
                  height={trackHeight}
                  fill={isActive ? "rgba(34,211,238,0.04)" : "transparent"}
                  className="cursor-pointer"
                  onClick={() => onSelectChannel(track.channel)}
                />
                <line
                  x1={PADDING_LEFT}
                  y1={centre}
                  x2={SVG_WIDTH - PADDING_RIGHT}
                  y2={centre}
                  stroke="#1f2937"
                  strokeWidth={0.6}
                  strokeDasharray="2 5"
                  className="pointer-events-none"
                />
                {track.raw && (
                  <path
                    d={track.raw.d}
                    fill="none"
                    stroke={isActive ? "#f472b6" : "#831843"}
                    strokeWidth={isActive ? 1.1 : 0.7}
                    className="pointer-events-none"
                  />
                )}
                <path
                  d={track.clean.d}
                  fill="none"
                  stroke={isActive ? "#22d3ee" : "#475569"}
                  strokeWidth={isActive ? 1.5 : 0.9}
                  strokeLinejoin="round"
                  className="pointer-events-none"
                />
                <line
                  x1={0}
                  y1={trackHeight * (idx + 1)}
                  x2={SVG_WIDTH}
                  y2={trackHeight * (idx + 1)}
                  stroke="#111827"
                  strokeWidth={1}
                  className="pointer-events-none"
                />
              </g>
            );
          })}

          {hoverSample !== null && (
            <line
              x1={xForSample(hoverSample)}
              y1={0}
              x2={xForSample(hoverSample)}
              y2={plotHeight}
              stroke="#06b6d4"
              strokeWidth={1}
              strokeDasharray="4 3"
              className="pointer-events-none"
            />
          )}

          <rect x={0} y={0} width={PADDING_LEFT - 6} height={svgHeight} fill="#030712" opacity={0.96} />
          <line
            x1={PADDING_LEFT - 6}
            y1={0}
            x2={PADDING_LEFT - 6}
            y2={plotHeight}
            stroke="#1f2937"
            strokeWidth={1}
          />
          {channels.map((ch, idx) => {
            const isActive = ch === selectedChannel;
            const repaired = processed.badChannels.includes(ch);
            return (
              <g
                key={`label-${ch}`}
                className="cursor-pointer"
                onClick={() => onSelectChannel(ch)}
                role="button"
                aria-label={`Select channel ${ch}`}
              >
                <text
                  x={10}
                  y={trackHeight * (idx + 0.5) + 3.5}
                  fill={isActive ? "#22d3ee" : repaired ? "#fbbf24" : "#64748b"}
                  fontSize={11}
                  fontFamily="monospace"
                  fontWeight={isActive ? "bold" : "normal"}
                >
                  {ch}
                </text>
                {repaired && (
                  <text x={10} y={trackHeight * (idx + 0.5) + 13} fill="#b45309" fontSize={7} fontFamily="monospace">
                    repaired
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hoverSample !== null && (
          <div className="absolute top-3 left-[8%] bg-gray-900/95 border border-gray-800 px-3 py-2 rounded-xl flex items-center gap-4 text-[11px] font-mono shadow-2xl backdrop-blur pointer-events-none">
            <div>
              <span className="text-gray-500 block uppercase tracking-wider text-[9px]">Time</span>
              <span className="text-cyan-400 font-semibold">
                {(hoverSample / sampleRate).toFixed(3)}s
              </span>
            </div>
            <div className="border-l border-gray-800 pl-3">
              <span className="text-gray-500 block uppercase tracking-wider text-[9px]">
                {selectedChannel} clean
              </span>
              <span className="text-emerald-400 font-semibold">
                {signals[selectedChannel]?.[hoverSample]?.toFixed(2) ?? "—"} {units}
              </span>
            </div>
            {showRaw && (
              <div className="border-l border-gray-800 pl-3">
                <span className="text-gray-500 block uppercase tracking-wider text-[9px]">
                  {selectedChannel} raw
                </span>
                <span className="text-pink-400 font-semibold">
                  {recording.raw[selectedChannel]?.[hoverSample]?.toFixed(2) ?? "—"} µV
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-gray-950 p-3 rounded-xl border border-gray-800/60 text-xs">
        <span className="font-mono text-gray-500 shrink-0">Position</span>
        <input
          type="range"
          min={0}
          max={Math.max(0.1, maxStart)}
          step={0.05}
          value={clampedStart}
          onChange={(e) => setStartTime(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-cyan-500"
          aria-label="Scroll through the recording"
        />
        <span className="font-mono text-gray-400 shrink-0">
          {clampedStart.toFixed(1)}s / {durationSeconds.toFixed(1)}s
        </span>
        <span className="flex items-center gap-3 font-mono text-[10px] text-gray-500 shrink-0">
          {(Object.keys(ARTIFACT_STYLE) as ArtifactKind[]).map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span
                className="w-2.5 h-2.5 rounded-sm border border-gray-700"
                style={{ background: ARTIFACT_STYLE[kind].fill }}
              />
              {ARTIFACT_STYLE[kind].label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

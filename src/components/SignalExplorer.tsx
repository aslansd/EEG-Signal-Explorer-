import React, { useState, useRef, useMemo } from "react";
import { EegDataPoint } from "../types";
import { ZoomIn, ZoomOut, ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";

interface SignalExplorerProps {
  dataPoints: EegDataPoint[];
  channels: string[];
  selectedChannel: string;
  onSelectChannel: (ch: string) => void;
  showCleaned: boolean;
  onToggleCleaned: (val: boolean) => void;
}

export default function SignalExplorer({
  dataPoints,
  channels,
  selectedChannel,
  onSelectChannel,
  showCleaned,
  onToggleCleaned,
}: SignalExplorerProps) {
  // Zoom state (how many seconds to display at once)
  const [windowSize, setWindowSize] = useState<number>(4.0); // seconds
  // Pan state (starting time of the display window)
  const [startTime, setStartTime] = useState<number>(0.0); // seconds

  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const duration = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].time : 20;

  // Clip pan state within bounds
  const clampedStartTime = Math.max(0, Math.min(duration - windowSize, startTime));

  // Filter data within current window
  const visibleData = useMemo(() => {
    return dataPoints.filter(
      (dp) => dp.time >= clampedStartTime && dp.time <= clampedStartTime + windowSize
    );
  }, [dataPoints, clampedStartTime, windowSize]);

  // Adjust zoom and pan helpers
  const handleZoom = (direction: "in" | "out") => {
    if (direction === "in") {
      setWindowSize((prev) => Math.max(1.0, prev - 1.0));
    } else {
      setWindowSize((prev) => Math.min(duration, prev + 2.0));
    }
  };

  const handlePan = (direction: "left" | "right") => {
    const step = windowSize * 0.35;
    if (direction === "left") {
      setStartTime((prev) => Math.max(0, prev - step));
    } else {
      setStartTime((prev) => Math.min(duration - windowSize, prev + step));
    }
  };

  // Find exact hover point value
  const hoverMetrics = useMemo(() => {
    if (hoveredTime === null || visibleData.length === 0) return null;
    // Find closest index
    let closest = visibleData[0];
    let minDiff = Math.abs(visibleData[0].time - hoveredTime);
    for (const dp of visibleData) {
      const diff = Math.abs(dp.time - hoveredTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = dp;
      }
    }
    return closest;
  }, [visibleData, hoveredTime]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Map X coordinate to time in the window
    const paddingLeft = 55;
    const width = rect.width - paddingLeft - 15;
    const clickRatio = (x - paddingLeft) / width;
    if (clickRatio >= 0 && clickRatio <= 1) {
      const targetTime = clampedStartTime + clickRatio * windowSize;
      setHoveredTime(targetTime);
    } else {
      setHoveredTime(null);
    }
  };

  // SVG Drawing Metrics
  const svgWidth = 800;
  const svgHeight = 450;
  const paddingLeft = 60;
  const paddingRight = 20;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const channelSpacing = svgHeight / (channels.length || 1);

  // Math helper to get coordinates
  const getX = (time: number) => {
    return paddingLeft + ((time - clampedStartTime) / windowSize) * plotWidth;
  };

  const getY = (value: number, channelIndex: number, ampScale = 0.6) => {
    const centerY = channelSpacing * (channelIndex + 0.5);
    // Scale value (typically -150 to +150 microvolts) to fit in channel spacing
    const yOffset = value * ampScale;
    // Prevent clipping beyond track boundaries
    const halfHeight = channelSpacing * 0.48;
    const limitedY = Math.max(-halfHeight, Math.min(halfHeight, yOffset));
    return centerY - limitedY;
  };

  // Compile artifact highlights as SVG block elements
  const artifactHighlights = useMemo(() => {
    const highlights: { x: number; width: number; type: "blink" | "muscle" | "ecg"; title: string }[] = [];
    let activeType: "blink" | "muscle" | "ecg" | null = null;
    let actStart = 0;

    for (let i = 0; i < visibleData.length; i++) {
      const dp = visibleData[i];
      let currentType: "blink" | "muscle" | "ecg" | null = null;
      if (dp.artifacts.eyeBlink) currentType = "blink";
      else if (dp.artifacts.muscle) currentType = "muscle";
      else if (dp.artifacts.ecg && i % 4 === 0) currentType = "ecg"; // ECG is rhythmic spikes

      if (currentType !== activeType) {
        if (activeType && activeType !== "ecg") {
          highlights.push({
            x: getX(actStart),
            width: getX(dp.time) - getX(actStart),
            type: activeType,
            title: activeType === "blink" ? "Eye Blink Transient" : "Muscle Clonic Artifact",
          });
        }
        activeType = currentType;
        actStart = dp.time;
      }
    }

    if (activeType && activeType !== "ecg") {
      highlights.push({
        x: getX(actStart),
        width: getX(clampedStartTime + windowSize) - getX(actStart),
        type: activeType,
        title: activeType === "blink" ? "Eye Blink Transient" : "Muscle Clonic Artifact",
      });
    }

    return highlights;
  }, [visibleData, clampedStartTime, windowSize]);

  return (
    <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col gap-4 h-full" id="signal-explorer-panel">
      {/* Waveform Explorer Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-200 flex items-center gap-2">
            Multitrack Waveform Sweep
            <span className="text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded-full font-mono">
              {channels.length} channels • {clampedStartTime.toFixed(1)}s - {(clampedStartTime + windowSize).toFixed(1)}s
            </span>
          </h3>
          <p className="text-xs text-gray-400">Click a track label to inspect; hover to measure signal potential.</p>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
          {/* Preprocessed Toggle */}
          <button
            onClick={() => onToggleCleaned(!showCleaned)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
              showCleaned
                ? "bg-emerald-950/80 border border-emerald-500/50 text-emerald-300"
                : "bg-gray-800/80 border border-gray-700 text-gray-400 hover:text-gray-200"
            }`}
            title="Toggle showing original raw signal vs. clean artifact-free signal"
          >
            {showCleaned ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showCleaned ? "Artifact Removed" : "Show Cleansed"}
          </button>

          {/* Navigation sweep buttons */}
          <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg p-0.5">
            <button
              onClick={() => handlePan("left")}
              disabled={clampedStartTime <= 0}
              className="p-1.5 hover:text-cyan-400 text-gray-400 disabled:opacity-20 transition-colors"
              title="Pan Left"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleZoom("in")}
              disabled={windowSize <= 1.0}
              className="p-1.5 hover:text-cyan-400 border-x border-gray-700 text-gray-400 disabled:opacity-20 transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleZoom("out")}
              disabled={windowSize >= duration}
              className="p-1.5 hover:text-cyan-400 border-r border-gray-700 text-gray-400 disabled:opacity-20 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handlePan("right")}
              disabled={clampedStartTime + windowSize >= duration}
              className="p-1.5 hover:text-cyan-400 text-gray-400 disabled:opacity-20 transition-colors"
              title="Pan Right"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* SVG EEG Grid Container */}
      <div ref={containerRef} className="relative w-full border border-gray-800 rounded-xl bg-gray-950 overflow-hidden flex-1 select-none">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-full"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredTime(null)}
        >
          {/* 1. Backdrop Grid Lines */}
          {channels.map((_, idx) => {
            const y = channelSpacing * (idx + 0.5);
            return (
              <line
                key={`grid-${idx}`}
                x1={paddingLeft}
                y1={y}
                x2={svgWidth - paddingRight}
                y2={y}
                stroke="#1f2937"
                strokeWidth="1"
                strokeDasharray="2 4"
              />
            );
          })}

          {/* Time Division Grids */}
          {Array.from({ length: 5 }).map((_, i) => {
            const t = clampedStartTime + (i * windowSize) / 4;
            const x = getX(t);
            return (
              <g key={`tgrid-${i}`}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={svgHeight}
                  stroke="#1e293b"
                  strokeWidth="0.5"
                />
                <text
                  x={x}
                  y={svgHeight - 6}
                  textAnchor="middle"
                  fill="#475569"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  {t.toFixed(1)}s
                </text>
              </g>
            );
          })}

          {/* 2. Artifact Backdrop Overlays */}
          {artifactHighlights.map((hl, i) => (
            <rect
              key={`artifact-${i}`}
              x={hl.x}
              y={0}
              width={Math.max(2, hl.width)}
              height={svgHeight}
              fill={hl.type === "blink" ? "rgba(239, 68, 68, 0.08)" : "rgba(245, 158, 11, 0.07)"}
              className="pointer-events-none"
            >
              <title>{hl.title}</title>
            </rect>
          ))}

          {/* 3. EEG Signal Lines */}
          {channels.map((ch, chIdx) => {
            const isHighlighted = ch === selectedChannel;
            
            // Build SVG path
            let pathD = "";
            let cleanedPathD = "";

            visibleData.forEach((dp, dpIdx) => {
              const x = getX(dp.time);
              const val = dp.channels[ch] || 0;
              const cleanedVal = dp.cleanedChannels[ch] || 0;

              const y = getY(val, chIdx);
              const cleanedY = getY(cleanedVal, chIdx);

              if (dpIdx === 0) {
                pathD = `M ${x} ${y}`;
                cleanedPathD = `M ${x} ${cleanedY}`;
              } else {
                pathD += ` L ${x} ${y}`;
                cleanedPathD += ` L ${x} ${cleanedY}`;
              }
            });

            const strokeColor = isHighlighted ? "#22d3ee" : "#334155";
            const strokeWidth = isHighlighted ? 2.0 : 1.0;

            const cleanedStrokeColor = isHighlighted ? "#10b981" : "#0f766e";

            return (
              <g key={`track-${ch}`} className="group">
                {/* Channel Click Overlay Target */}
                <rect
                  x={0}
                  y={channelSpacing * chIdx}
                  width={svgWidth}
                  height={channelSpacing}
                  fill="transparent"
                  className="cursor-pointer hover:bg-slate-900/10 transition-colors"
                  onClick={() => onSelectChannel(ch)}
                />

                {/* Raw Waveform Line */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-all duration-100 pointer-events-none opacity-80"
                />

                {/* Cleaned Waveform Line (Overlaid) */}
                {showCleaned && (
                  <path
                    d={cleanedPathD}
                    fill="none"
                    stroke={cleanedStrokeColor}
                    strokeWidth={isHighlighted ? 1.8 : 0.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-100 pointer-events-none"
                  />
                )}

                {/* Horizontal Divider Line */}
                <line
                  x1={0}
                  y1={channelSpacing * (chIdx + 1)}
                  x2={svgWidth}
                  y2={channelSpacing * (chIdx + 1)}
                  stroke="#111827"
                  strokeWidth="1.5"
                />
              </g>
            );
          })}

          {/* 4. Interactive Hover Line */}
          {hoveredTime !== null && (
            <line
              x1={getX(hoveredTime)}
              y1={0}
              x2={getX(hoveredTime)}
              y2={svgHeight}
              stroke="#06b6d4"
              strokeWidth="1.2"
              strokeDasharray="4 2"
              className="pointer-events-none"
            />
          )}

          {/* 5. Left Rail: Channel Labels */}
          <rect x={0} y={0} width={paddingLeft - 5} height={svgHeight} fill="#030712" opacity="0.95" />
          <line x1={paddingLeft - 5} y1={0} x2={paddingLeft - 5} y2={svgHeight} stroke="#1f2937" strokeWidth="1" />
          {channels.map((ch, chIdx) => {
            const isHighlighted = ch === selectedChannel;
            return (
              <g key={`lbl-${ch}`} className="cursor-pointer" onClick={() => onSelectChannel(ch)}>
                <text
                  x={12}
                  y={channelSpacing * (chIdx + 0.6)}
                  fill={isHighlighted ? "#22d3ee" : "#64748b"}
                  fontSize="11"
                  fontFamily="monospace"
                  fontWeight={isHighlighted ? "bold" : "medium"}
                >
                  {ch}
                </text>
                {/* Small indicator circle */}
                <circle
                  cx={42}
                  cy={channelSpacing * (chIdx + 0.5)}
                  r="3.5"
                  fill={isHighlighted ? "#22d3ee" : "transparent"}
                />
              </g>
            );
          })}
        </svg>

        {/* Float Telemetry Overlay (Active Hover Measurements) */}
        {hoverMetrics && (
          <div className="absolute top-3 left-16 bg-gray-900/90 border border-gray-800 px-3 py-2 rounded-xl flex items-center gap-4 text-[11px] font-mono shadow-2xl backdrop-blur-md pointer-events-none max-w-sm">
            <div>
              <span className="text-gray-400 block uppercase tracking-wider text-[9px]">Time</span>
              <span className="text-cyan-400 font-semibold">{hoverMetrics.time.toFixed(3)}s</span>
            </div>
            <div className="border-l border-gray-800 pl-3">
              <span className="text-gray-400 block uppercase tracking-wider text-[9px]">{selectedChannel} Raw</span>
              <span className="text-pink-400 font-semibold">{(hoverMetrics.channels[selectedChannel] || 0).toFixed(1)} uV</span>
            </div>
            {showCleaned && (
              <div className="border-l border-gray-800 pl-3">
                <span className="text-gray-400 block uppercase tracking-wider text-[9px]">{selectedChannel} Clean</span>
                <span className="text-emerald-400 font-semibold">{(hoverMetrics.cleanedChannels[selectedChannel] || 0).toFixed(1)} uV</span>
              </div>
            )}
            {/* Artifact alerts */}
            {(hoverMetrics.artifacts.eyeBlink || hoverMetrics.artifacts.muscle) && (
              <div className="border-l border-gray-800 pl-3 flex flex-col gap-0.5 justify-center">
                {hoverMetrics.artifacts.eyeBlink && (
                  <span className="bg-red-950 text-red-400 border border-red-900 px-1 py-0.5 rounded text-[8px] font-bold">BLINK</span>
                )}
                {hoverMetrics.artifacts.muscle && (
                  <span className="bg-amber-950 text-amber-400 border border-amber-900 px-1 py-0.5 rounded text-[8px] font-bold">MUSCLE</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Panning & Time Sweep bar */}
      <div className="flex items-center gap-3 bg-gray-950 p-3 rounded-xl border border-gray-800/60 text-xs">
        <span className="font-mono text-gray-500">Timeline Sweep</span>
        <input
          type="range"
          min="0"
          max={(duration - windowSize).toFixed(1)}
          step="0.1"
          value={clampedStartTime}
          onChange={(e) => setStartTime(parseFloat(e.target.value))}
          className="flex-1 accent-cyan-500 bg-gray-800 h-1.5 rounded-lg appearance-none cursor-pointer"
        />
        <span className="font-mono text-gray-400">{clampedStartTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
      </div>
    </div>
  );
}

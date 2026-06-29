import React, { useState } from "react";
import { SpectralBandPower } from "../types";

interface ScalpMapProps {
  bandPowers: SpectralBandPower[];
  selectedBand: "delta" | "theta" | "alpha" | "beta" | "gamma";
}

// 10-20 Electrode coordinate map on a 200x200 canvas
const ELECTRODE_COORDS: Record<string, { x: number; y: number; label: string }> = {
  Fp1: { x: 70, y: 40, label: "Fp1" },
  Fp2: { x: 130, y: 40, label: "Fp2" },
  F7: { x: 42, y: 70, label: "F7" },
  F3: { x: 72, y: 72, label: "F3" },
  F4: { x: 128, y: 72, label: "F4" },
  F8: { x: 158, y: 70, label: "F8" },
  T3: { x: 30, y: 100, label: "T3" },
  C3: { x: 70, y: 100, label: "C3" },
  C4: { x: 130, y: 100, label: "C4" },
  T4: { x: 170, y: 100, label: "T4" },
  O1: { x: 75, y: 160, label: "O1" },
  O2: { x: 125, y: 160, label: "O2" },
};

export default function ScalpMap({ bandPowers, selectedBand }: ScalpMapProps) {
  const [hoveredElectrode, setHoveredElectrode] = useState<{ label: string; value: number } | null>(null);

  // Find max value in current band to normalize color scale
  const activeValues = bandPowers.map((p) => p[selectedBand] || 0.1);
  const maxVal = Math.max(...activeValues, 5.0);
  const minVal = Math.min(...activeValues, 0.5);

  // Helper to map a power value to a warm-cool RGB string or Tailwind color
  // Warm: high activity (red), Cool: low activity (blue)
  const getColorForPower = (val: number) => {
    const ratio = Math.max(0, Math.min(1, (val - minVal) / (maxVal - minVal || 1)));
    
    // Smooth transition: Blue (0) -> Cyan (0.3) -> Green/Yellow (0.6) -> Orange/Red (1)
    let r = 0, g = 0, b = 0;
    if (ratio < 0.33) {
      // Blue to Cyan
      b = 240;
      g = Math.floor(ratio * 3 * 200);
      r = 30;
    } else if (ratio < 0.66) {
      // Cyan to Yellow
      r = Math.floor((ratio - 0.33) * 3 * 220);
      g = 220;
      b = Math.floor((0.66 - ratio) * 3 * 200);
    } else {
      // Yellow to Red
      r = 240;
      g = Math.floor((1 - ratio) * 3 * 200);
      b = 30;
    }
    return `rgb(${r}, ${g}, ${b})`;
  };

  const getBandLabel = (band: typeof selectedBand) => {
    switch (band) {
      case "delta": return "Delta (0.5 - 4 Hz) - Slow Wave Sleep";
      case "theta": return "Theta (4 - 8 Hz) - Drowsy / Deep Meditation";
      case "alpha": return "Alpha (8 - 12 Hz) - Awake Relaxed";
      case "beta": return "Beta (12 - 30 Hz) - Active Cognitive Task";
      case "gamma": return "Gamma (30 - 50 Hz) - Peak Integration";
    }
  };

  return (
    <div className="flex flex-col items-center bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl h-full justify-between" id="scalp-map-container">
      <div className="w-full text-center mb-3">
        <h4 className="text-sm font-semibold text-gray-300 font-sans tracking-wide">Topographic Scalp Map</h4>
        <p className="text-xs font-mono text-cyan-400 mt-1 capitalize">{getBandLabel(selectedBand)}</p>
      </div>

      <div className="relative w-full max-w-[280px] aspect-square flex items-center justify-center my-4">
        {/* SVG Topo Plot */}
        <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-[0_0_15px_rgba(34,211,238,0.1)]">
          {/* Heat Interpolation overlay using Radial Gradients for each available electrode */}
          <defs>
            {bandPowers.map((bp) => {
              const coord = ELECTRODE_COORDS[bp.channel];
              if (!coord) return null;
              const col = getColorForPower(bp[selectedBand]);
              return (
                <radialGradient
                  key={`grad-${bp.channel}`}
                  id={`grad-${bp.channel}`}
                  cx="50%"
                  cy="50%"
                  r="50%"
                  fx="50%"
                  fy="50%"
                >
                  <stop offset="0%" stopColor={col} stopOpacity={0.6} />
                  <stop offset="60%" stopColor={col} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={col} stopOpacity={0} />
                </radialGradient>
              );
            })}
          </defs>

          {/* Interpolated Heatmap Backdrop (rendered first so circles/labels stack on top) */}
          <g>
            {bandPowers.map((bp) => {
              const coord = ELECTRODE_COORDS[bp.channel];
              if (!coord) return null;
              return (
                <circle
                  key={`heat-${bp.channel}`}
                  cx={coord.x}
                  cy={coord.y}
                  r="35"
                  fill={`url(#grad-${bp.channel})`}
                  className="mix-blend-screen"
                />
              );
            })}
          </g>

          {/* Scalp Outline */}
          <circle cx="100" cy="100" r="82" fill="none" stroke="#4b5563" strokeWidth="2" strokeDasharray="3 3" />
          <circle cx="100" cy="100" r="80" fill="none" stroke="#6b7280" strokeWidth="1.5" />

          {/* Nose */}
          <path d="M 92 20 L 100 8 L 108 20" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Left Ear */}
          <path d="M 20 90 C 12 90, 12 110, 20 110" fill="none" stroke="#6b7280" strokeWidth="1.5" />
          
          {/* Right Ear */}
          <path d="M 180 90 C 188 90, 188 110, 180 110" fill="none" stroke="#6b7280" strokeWidth="1.5" />

          {/* Electrodes */}
          {bandPowers.map((bp) => {
            const coord = ELECTRODE_COORDS[bp.channel];
            if (!coord) return null;
            const powerVal = bp[selectedBand];
            const isHovered = hoveredElectrode?.label === bp.channel;

            return (
              <g
                key={bp.channel}
                className="cursor-pointer transition-transform duration-200"
                onMouseEnter={() => setHoveredElectrode({ label: bp.channel, value: powerVal })}
                onMouseLeave={() => setHoveredElectrode(null)}
              >
                {/* Outer halo */}
                <circle
                  cx={coord.x}
                  cy={coord.y}
                  r={isHovered ? "11" : "8"}
                  fill={getColorForPower(powerVal)}
                  stroke="#111827"
                  strokeWidth="1.5"
                  className="transition-all duration-150"
                />
                {/* Center dot */}
                <circle cx={coord.x} cy={coord.y} r="2" fill="#ffffff" />
                {/* Electrode text label */}
                <text
                  x={coord.x}
                  y={coord.y - 12}
                  textAnchor="middle"
                  fill={isHovered ? "#22d3ee" : "#9ca3af"}
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight={isHovered ? "bold" : "normal"}
                  className="transition-colors duration-150 select-none"
                >
                  {bp.channel}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating tooltip */}
        {hoveredElectrode && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-gray-950/95 border border-cyan-500/50 px-3 py-1.5 rounded-lg text-center shadow-2xl z-20 pointer-events-none">
            <span className="text-[10px] font-mono text-gray-400 block font-bold">{hoveredElectrode.label}</span>
            <span className="text-xs font-mono text-cyan-300 font-semibold">{hoveredElectrode.value.toFixed(1)} μV²</span>
          </div>
        )}
      </div>

      {/* Color Scale Legend */}
      <div className="w-full px-2 mt-2">
        <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono mb-1">
          <span>{minVal.toFixed(1)} μV²</span>
          <span>Relative Intensity</span>
          <span>{maxVal.toFixed(1)} μV²</span>
        </div>
        <div className="h-2 rounded-full w-full bg-gradient-to-r from-blue-600 via-green-400 to-red-600 border border-gray-800" />
      </div>
    </div>
  );
}

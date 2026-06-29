import React, { useEffect, useRef, useState, useMemo } from "react";
import { EegDataPoint, EegScenarioId } from "../types";

interface SpectrogramProps {
  dataPoints: EegDataPoint[];
  selectedChannel: string;
  scenarioId: EegScenarioId;
}

export default function Spectrogram({ dataPoints, selectedChannel, scenarioId }: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverInfo, setHoverInfo] = useState<{ time: number; hz: number; intensity: number } | null>(null);

  const duration = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].time : 20;

  // Render Spectrogram on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, width, height);

    // Number of time slices (columns)
    const numColumns = 100;
    const numFreqRows = 40; // represents 0.5Hz to 40Hz

    const colWidth = width / numColumns;
    const rowHeight = height / numFreqRows;

    // Draw the frequency heat map
    for (let c = 0; c < numColumns; c++) {
      const colTime = (c / numColumns) * duration;
      
      // Find matching data point to get active label & artifact state
      const sampleIdx = Math.min(
        dataPoints.length - 1,
        Math.floor((colTime / duration) * dataPoints.length)
      );
      const dp = dataPoints[sampleIdx] || { predictedLabel: "Normal", artifacts: { eyeBlink: false, muscle: false, ecg: false } };
      const label = dp.predictedLabel;

      for (let r = 0; r < numFreqRows; r++) {
        // Reverse row index so high frequencies are at the top, low frequencies at the bottom
        const hz = 0.5 + ((numFreqRows - r) / numFreqRows) * 45;

        // Simulate natural biological intensity for the specific brain state
        let basePower = 18 / Math.pow(hz, 0.7); // 1/f background

        // Scenario-specific frequency peak modulation
        if (scenarioId === "sleep") {
          if (label === "Wake" && hz >= 8 && hz <= 12) {
            basePower += 22; // Alpha peak
          } else if (label === "N1" && hz >= 4 && hz <= 8) {
            basePower += 18; // Theta slowing
          } else if (label === "N2") {
            if (hz >= 12 && hz <= 14) basePower += 25; // Sleep Spindles
            if (hz >= 4 && hz <= 8) basePower += 12;
          } else if (label === "N3" && hz >= 0.5 && hz <= 3.5) {
            basePower += 48; // Massive delta peaks
          } else if (label === "REM" && hz >= 5 && hz <= 8) {
            basePower += 16;
          }
        } else if (scenarioId === "epilepsy") {
          if (label === "Pre-seizure" && hz >= 3 && hz <= 7) {
            basePower += 20; // Pre-ictal slowing
          } else if (label === "Seizure") {
            // Seizure displays huge hypersynchrony across a wide band
            if (hz >= 1 && hz <= 15) basePower += 55;
            if (hz >= 15 && hz <= 35) basePower += 35;
          }
        } else if (scenarioId === "workload") {
          if (label === "Low Workload" && hz >= 9 && hz <= 12) {
            basePower += 22; // Relaxed parietal alpha
          } else if (label === "High Workload") {
            if (hz >= 4 && hz <= 7) basePower += 24; // High frontal theta
            if (hz >= 13 && hz <= 25) basePower += 15; // Beta active load
          }
        } else {
          // meditation
          if (label === "Distracted" && hz >= 14 && hz <= 24) {
            basePower += 20; // Frustrated beta chatter
          } else if (label === "Focused Relaxed" && hz >= 8 && hz <= 12) {
            basePower += 35; // Deep calm alpha
          } else if (label === "Deep Zen State") {
            if (hz >= 4 && hz <= 8) basePower += 28; // Frontal theta focus
            if (hz >= 30 && hz <= 45) basePower += 22; // Coherent gamma binding
          }
        }

        // Add transient artifacts to the spectrogram
        if (dp.artifacts.eyeBlink && hz <= 5) {
          basePower += 60; // Huge red blast in slow delta region
        }
        if (dp.artifacts.muscle && hz >= 25) {
          basePower += 40; // High frequency white/yellow muscle noise
        }

        // Add small random noise to make it look realistic
        basePower += Math.random() * 4;

        // Normalise power value to ratio (0 to 1)
        const maxExpectedPower = 85;
        const ratio = Math.min(1, Math.max(0, basePower / maxExpectedPower));

        // Color mapping: Cool (dark blue) -> Green/Yellow -> Warm (red/white)
        let color = "#030712";
        if (ratio < 0.25) {
          // Dark blue to blue
          const b = Math.floor(ratio * 4 * 160) + 40;
          color = `rgb(3, ${Math.floor(ratio * 100)}, ${b})`;
        } else if (ratio < 0.5) {
          // Blue to Teal/Green
          const g = Math.floor((ratio - 0.25) * 4 * 180) + 20;
          color = `rgb(3, ${g}, ${200 - Math.floor((ratio - 0.25) * 4 * 100)})`;
        } else if (ratio < 0.75) {
          // Green to Yellow/Orange
          const r = Math.floor((ratio - 0.5) * 4 * 220);
          color = `rgb(${r}, 200, 30)`;
        } else {
          // Orange to Red/White
          const r = 220 + Math.floor((ratio - 0.75) * 4 * 35);
          const gb = Math.floor((ratio - 0.75) * 4 * 200);
          color = `rgb(${r}, ${gb}, ${gb})`;
        }

        ctx.fillStyle = color;
        ctx.fillRect(c * colWidth, r * rowHeight, colWidth, rowHeight);
      }
    }
  }, [dataPoints, selectedChannel, scenarioId, duration]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const timeRatio = x / rect.width;
    const freqRatio = (rect.height - y) / rect.height; // reverse Y coordinate

    const time = timeRatio * duration;
    const hz = 0.5 + freqRatio * 45;

    // Pull approximate intensity based on current brain state
    const sampleIdx = Math.min(
      dataPoints.length - 1,
      Math.floor((time / duration) * dataPoints.length)
    );
    const label = dataPoints[sampleIdx]?.predictedLabel || "Normal";
    let basePower = 18 / Math.pow(hz, 0.7);
    if (label === "Wake" && hz >= 8 && hz <= 12) basePower += 22;
    if (label === "N3" && hz <= 3.5) basePower += 48;
    if (label === "Seizure" && hz <= 15) basePower += 55;

    setHoverInfo({ time, hz, intensity: basePower });
  };

  return (
    <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col gap-3 h-full" id="spectrogram-panel">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-sm font-semibold text-gray-200">Continuous 2D Spectrogram</h4>
          <p className="text-xs text-gray-400 mt-0.5">Time-varying spectral intensity heatmap (0.5Hz - 45Hz on vertical axis).</p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono bg-gray-950 px-2 py-1 border border-gray-800 rounded-lg text-gray-400">
          <div className="w-2 h-2 rounded-full bg-blue-600" />
          <span>Low</span>
          <div className="w-2 h-2 rounded-full bg-yellow-500" />
          <div className="w-2 h-2 rounded-full bg-red-600" />
          <span>High Potential</span>
        </div>
      </div>

      <div className="relative w-full border border-gray-800 rounded-xl bg-gray-950 overflow-hidden" style={{ minHeight: "140px" }}>
        {/* Canvas for rendering heavy spectrogram graphics */}
        <canvas
          ref={canvasRef}
          width="800"
          height="160"
          className="w-full h-full block cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
        />

        {/* Vertical axis line annotations */}
        <div className="absolute left-2 top-1 bottom-1 flex flex-col justify-between text-[8px] font-mono text-gray-500 pointer-events-none select-none bg-gray-950/80 px-1 py-0.5 rounded border border-gray-800/50">
          <span>45Hz</span>
          <span>30Hz</span>
          <span>15Hz</span>
          <span>1Hz</span>
        </div>

        {/* Hover measurements tool overlay */}
        {hoverInfo && (
          <div className="absolute top-2 right-2 bg-gray-950/95 border border-cyan-500/50 px-3 py-1.5 rounded-lg text-xs font-mono shadow-2xl pointer-events-none text-right flex flex-col gap-0.5">
            <span className="text-gray-400 text-[10px]">T: <span className="text-cyan-400 font-semibold">{hoverInfo.time.toFixed(2)}s</span></span>
            <span className="text-gray-400 text-[10px]">F: <span className="text-purple-400 font-semibold">{hoverInfo.hz.toFixed(1)}Hz</span></span>
            <span className="text-gray-400 text-[10px]">Pwr: <span className="text-amber-400 font-semibold">{hoverInfo.intensity.toFixed(1)} dB</span></span>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono px-1">
        <span>0.0s (Start)</span>
        <span>10.0s (Mid)</span>
        <span>20.0s (Sweep Limit)</span>
      </div>
    </div>
  );
}

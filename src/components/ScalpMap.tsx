import { useEffect, useMemo, useRef, useState } from "react";
import { MONTAGE } from "../data/presets";
import { BAND_ORDER, EEG_BANDS } from "../lib/dsp";
import type { BandName, BandPowerRow } from "../types";

interface ScalpMapProps {
  bandPower: BandPowerRow[];
  selectedBand: BandName;
  onSelectBand: (band: BandName) => void;
  selectedChannel: string;
  onSelectChannel: (ch: string) => void;
}

const SIZE = 240;
const RADIUS = SIZE * 0.42;
const CENTRE = SIZE / 2;

function heatColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  const stops: [number, [number, number, number]][] = [
    [0, [30, 64, 175]],
    [0.35, [14, 165, 233]],
    [0.55, [16, 185, 129]],
    [0.75, [250, 204, 21]],
    [1, [239, 68, 68]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (x >= p0 && x <= p1) {
      const u = (x - p0) / (p1 - p0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * u);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * u);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * u);
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(239,68,68)";
}

export default function ScalpMap({
  bandPower,
  selectedBand,
  onSelectBand,
  selectedChannel,
  onSelectChannel,
}: ScalpMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<{ channel: string; value: number } | null>(null);

  const sites = useMemo(
    () =>
      bandPower
        .filter((row) => MONTAGE[row.channel])
        .map((row) => ({
          channel: row.channel,
          value: row[selectedBand],
          x: CENTRE + MONTAGE[row.channel].x * RADIUS,
          y: CENTRE - MONTAGE[row.channel].y * RADIUS,
        })),
    [bandPower, selectedBand],
  );

  const { min, max } = useMemo(() => {
    if (!sites.length) return { min: 0, max: 1 };
    const values = sites.map((s) => s.value);
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [sites]);

  /**
   * Inverse-distance-weighted interpolation onto a canvas.
   *
   * The previous map stacked one 35 px radial gradient per electrode with
   * `mix-blend-screen`, which is not interpolation: values did not blend between
   * sites, the gaps between electrodes stayed dark, and screen blending pushed
   * overlapping regions towards white regardless of their power. Shepard's method
   * over the whole disc gives a continuous field, which is what a topographic map
   * is supposed to show.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sites.length) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(SIZE * dpr);
    canvas.height = Math.round(SIZE * dpr);
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(canvas.width, canvas.height);
    const span = max - min || 1;
    const scaledRadius = RADIUS * dpr;
    const scaledCentre = CENTRE * dpr;

    for (let py = 0; py < canvas.height; py++) {
      for (let px = 0; px < canvas.width; px++) {
        const dx = px - scaledCentre;
        const dy = py - scaledCentre;
        const dist = Math.hypot(dx, dy);
        const offset = (py * canvas.width + px) * 4;

        if (dist > scaledRadius * 1.04) {
          image.data[offset + 3] = 0;
          continue;
        }

        let weighted = 0;
        let weightSum = 0;
        for (const site of sites) {
          const sx = site.x * dpr;
          const sy = site.y * dpr;
          const d = Math.hypot(px - sx, py - sy);
          if (d < 1) {
            weighted = site.value;
            weightSum = 1;
            break;
          }
          const w = 1 / (d * d);
          weighted += site.value * w;
          weightSum += w;
        }

        const value = weightSum > 0 ? weighted / weightSum : min;
        const colour = heatColor((value - min) / span);
        const match = /rgb\((\d+),(\d+),(\d+)\)/.exec(colour);
        if (!match) continue;
        image.data[offset] = Number(match[1]);
        image.data[offset + 1] = Number(match[2]);
        image.data[offset + 2] = Number(match[3]);
        // Feather the outer edge so the disc does not end in a hard ring.
        const edge = Math.min(1, Math.max(0, (scaledRadius * 1.02 - dist) / (scaledRadius * 0.06)));
        image.data[offset + 3] = Math.round(215 * edge);
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [sites, min, max]);

  return (
    <div className="flex flex-col bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl h-full gap-3">
      <div className="text-center">
        <h4 className="text-sm font-semibold text-gray-200">Topographic map</h4>
        <p className="text-xs font-mono text-cyan-400 mt-0.5 capitalize">
          {selectedBand} ({EEG_BANDS[selectedBand][0]}–{EEG_BANDS[selectedBand][1]} Hz)
        </p>
      </div>

      <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
        <canvas ref={canvasRef} className="absolute inset-0 rounded-full" />
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 w-full h-full">
          <circle cx={CENTRE} cy={CENTRE} r={RADIUS} fill="none" stroke="#6b7280" strokeWidth={1.5} />
          <path
            d={`M ${CENTRE - 9} ${CENTRE - RADIUS - 1} L ${CENTRE} ${CENTRE - RADIUS - 14} L ${CENTRE + 9} ${CENTRE - RADIUS - 1}`}
            fill="none"
            stroke="#6b7280"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          <path
            d={`M ${CENTRE - RADIUS} ${CENTRE - 12} C ${CENTRE - RADIUS - 9} ${CENTRE - 12}, ${CENTRE - RADIUS - 9} ${CENTRE + 12}, ${CENTRE - RADIUS} ${CENTRE + 12}`}
            fill="none"
            stroke="#6b7280"
            strokeWidth={1.5}
          />
          <path
            d={`M ${CENTRE + RADIUS} ${CENTRE - 12} C ${CENTRE + RADIUS + 9} ${CENTRE - 12}, ${CENTRE + RADIUS + 9} ${CENTRE + 12}, ${CENTRE + RADIUS} ${CENTRE + 12}`}
            fill="none"
            stroke="#6b7280"
            strokeWidth={1.5}
          />

          {sites.map((site) => {
            const isActive = site.channel === selectedChannel;
            return (
              <g
                key={site.channel}
                className="cursor-pointer"
                onMouseEnter={() => setHovered({ channel: site.channel, value: site.value })}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectChannel(site.channel)}
                role="button"
                aria-label={`${site.channel}: ${site.value.toFixed(1)} microvolts squared`}
              >
                <circle
                  cx={site.x}
                  cy={site.y}
                  r={isActive ? 6 : 4.5}
                  fill={isActive ? "#22d3ee" : "#e5e7eb"}
                  stroke="#030712"
                  strokeWidth={1.5}
                />
                <text
                  x={site.x}
                  y={site.y - 9}
                  textAnchor="middle"
                  fill={isActive ? "#22d3ee" : "#d1d5db"}
                  fontSize={8}
                  fontFamily="monospace"
                  fontWeight={isActive ? "bold" : "normal"}
                  className="select-none"
                  style={{ paintOrder: "stroke", stroke: "#030712", strokeWidth: 2.5 }}
                >
                  {site.channel}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-gray-950/95 border border-cyan-500/50 px-2.5 py-1 rounded-lg text-center shadow-2xl pointer-events-none">
            <span className="text-[10px] font-mono text-gray-400 block font-bold">{hovered.channel}</span>
            <span className="text-[11px] font-mono text-cyan-300 font-semibold">
              {hovered.value.toFixed(1)} µV²
            </span>
          </div>
        )}
      </div>

      <div className="px-1">
        <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono mb-1">
          <span>{min.toFixed(1)}</span>
          <span className="text-gray-500">µV² across electrodes</span>
          <span>{max.toFixed(1)}</span>
        </div>
        <div
          className="h-2 rounded-full w-full border border-gray-800"
          style={{ background: "linear-gradient(90deg,#1e40af,#0ea5e9,#10b981,#facc15,#ef4444)" }}
        />
      </div>

      <div className="flex gap-1 p-1 bg-gray-950 border border-gray-850 rounded-xl text-[10px] font-mono">
        {BAND_ORDER.map((band) => (
          <button
            key={band}
            type="button"
            onClick={() => onSelectBand(band)}
            aria-pressed={selectedBand === band}
            className={`flex-1 py-1 rounded font-bold capitalize transition-colors ${
              selectedBand === band ? "bg-cyan-600 text-white" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {band.slice(0, 3)}
          </button>
        ))}
      </div>
    </div>
  );
}

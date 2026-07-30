import { useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { BAND_COLORS } from "../data/presets";
import { BAND_ORDER, EEG_BANDS } from "../lib/dsp";
import type { BandName, BandPowerRow, Psd } from "../types";
import { clientToSvg } from "../lib/chart";
import { exportSvgAsPng } from "../lib/io";

interface SpectralChartsProps {
  psd: Psd;
  bandPower: BandPowerRow | undefined;
  selectedChannel: string;
  displayLog: boolean;
  onToggleLog: (value: boolean) => void;
  fileStem: string;
}

const SVG_WIDTH = 560;
const SVG_HEIGHT = 240;
const PAD_LEFT = 48;
const PAD_RIGHT = 14;
const PAD_TOP = 22;
const PAD_BOTTOM = 30;

export default function SpectralCharts({
  psd,
  bandPower,
  selectedChannel,
  displayLog,
  onToggleLog,
  fileStem,
}: SpectralChartsProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ hz: number; value: number } | null>(null);

  const graphWidth = SVG_WIDTH - PAD_LEFT - PAD_RIGHT;
  const graphHeight = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM;

  /**
   * Plot the measured spectrum.
   *
   * This used to be five Gaussian bumps drawn on a `25/f^0.95` baseline, generated
   * from the band-power lookup table and labelled as a Welch transform. It is now
   * the actual Welch estimate of the selected channel, so it changes when the
   * filters change and shows the real 1/f slope, the mains peak when the notch is
   * off, and the filter roll-off at the band edges.
   */
  const maxHz = useMemo(() => {
    const nyquist = psd.freqs.length ? psd.freqs[psd.freqs.length - 1] : 50;
    return Math.min(nyquist, 60);
  }, [psd]);

  const visible = useMemo(() => {
    const points: { hz: number; power: number }[] = [];
    for (let k = 0; k < psd.freqs.length; k++) {
      const hz = psd.freqs[k];
      if (hz < 0.3 || hz > maxHz) continue;
      points.push({ hz, power: psd.power[k] });
    }
    return points;
  }, [psd, maxHz]);

  const transform = (power: number) => (displayLog ? Math.log10(Math.max(power, 1e-4)) : power);

  const { minY, maxY } = useMemo(() => {
    if (!visible.length) return { minY: 0, maxY: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of visible) {
      const v = transform(p.power);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!displayLog) lo = 0;
    const span = hi - lo || 1;
    return { minY: lo - span * 0.04, maxY: hi + span * 0.08 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, displayLog]);

  const xFor = (hz: number) => PAD_LEFT + (hz / maxHz) * graphWidth;
  const yFor = (power: number) =>
    PAD_TOP + graphHeight - ((transform(power) - minY) / (maxY - minY)) * graphHeight;

  const linePath = useMemo(() => {
    let d = "";
    visible.forEach((p, i) => {
      d += `${i === 0 ? "M" : "L"} ${xFor(p.hz).toFixed(2)} ${yFor(p.power).toFixed(2)} `;
    });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, minY, maxY, displayLog, maxHz]);

  const fillPath = useMemo(() => {
    if (!visible.length || !linePath) return "";
    const baseY = PAD_TOP + graphHeight;
    return `${linePath} L ${xFor(visible[visible.length - 1].hz).toFixed(2)} ${baseY} L ${xFor(visible[0].hz).toFixed(2)} ${baseY} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linePath, visible, maxHz]);

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !visible.length) return;
    const local = clientToSvg(svg, event.clientX, event.clientY);
    if (!local) return;
    const ratio = (local.x - PAD_LEFT) / graphWidth;
    if (ratio < 0 || ratio > 1) {
      setHover(null);
      return;
    }
    const targetHz = ratio * maxHz;
    let closest = visible[0];
    let bestDiff = Math.abs(closest.hz - targetHz);
    for (const p of visible) {
      const diff = Math.abs(p.hz - targetHz);
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = p;
      }
    }
    setHover({ hz: closest.hz, value: closest.power });
  };

  const total = bandPower?.total ?? 0;
  const ratioFor = (band: BandName) => (total > 0 && bandPower ? bandPower[band] / total : 0);

  const yTicks = 4;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      <div className="xl:col-span-8 bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col gap-3">
        <div className="flex flex-wrap justify-between items-start gap-2">
          <div>
            <h4 className="text-sm font-semibold text-gray-200">
              Power spectral density — {selectedChannel}
            </h4>
            <p className="text-xs text-gray-400">
              Welch estimate, {psd.segments} segment{psd.segments === 1 ? "" : "s"} averaged,{" "}
              {psd.resolution.toFixed(3)} Hz resolution.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggleLog(!displayLog)}
              aria-pressed={displayLog}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono border transition-colors ${
                displayLog
                  ? "bg-cyan-950/60 border-cyan-700 text-cyan-300"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
              }`}
            >
              {displayLog ? "log scale" : "linear"}
            </button>
            <button
              type="button"
              onClick={() => svgRef.current && exportSvgAsPng(svgRef.current, `${fileStem}-psd.png`)}
              title="Download as PNG"
              className="p-1.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-cyan-400 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="w-full h-auto"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`Power spectral density for channel ${selectedChannel}`}
        >
          <rect x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT} fill="#030712" />

          <g opacity={0.13}>
            {BAND_ORDER.map((band) => {
              const [lo, hi] = EEG_BANDS[band];
              if (lo > maxHz) return null;
              const x = xFor(lo);
              const width = xFor(Math.min(hi, maxHz)) - x;
              return (
                <rect
                  key={band}
                  x={x}
                  y={PAD_TOP}
                  width={Math.max(0, width)}
                  height={graphHeight}
                  fill={BAND_COLORS[band]}
                />
              );
            })}
          </g>

          <g fontSize={9} fontFamily="monospace" fontWeight="bold">
            {BAND_ORDER.map((band) => {
              const [lo, hi] = EEG_BANDS[band];
              if (lo > maxHz) return null;
              const mid = (xFor(lo) + xFor(Math.min(hi, maxHz))) / 2;
              return (
                <text key={band} x={mid} y={PAD_TOP - 7} textAnchor="middle" fill={BAND_COLORS[band]}>
                  {band[0]}
                </text>
              );
            })}
          </g>

          {Array.from({ length: yTicks + 1 }).map((_, i) => {
            const value = minY + ((maxY - minY) * i) / yTicks;
            const y = PAD_TOP + graphHeight - (i / yTicks) * graphHeight;
            const label = displayLog ? `1e${value.toFixed(1)}` : value.toFixed(value < 10 ? 1 : 0);
            return (
              <g key={`y-${i}`}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={SVG_WIDTH - PAD_RIGHT}
                  y2={y}
                  stroke="#1f2937"
                  strokeWidth={0.5}
                />
                <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fill="#4b5563" fontSize={8} fontFamily="monospace">
                  {label}
                </text>
              </g>
            );
          })}

          {[10, 20, 30, 40, 50, 60].filter((hz) => hz <= maxHz).map((hz) => (
            <g key={`x-${hz}`}>
              <line
                x1={xFor(hz)}
                y1={PAD_TOP}
                x2={xFor(hz)}
                y2={PAD_TOP + graphHeight}
                stroke="#1f2937"
                strokeWidth={0.5}
              />
              <text
                x={xFor(hz)}
                y={SVG_HEIGHT - PAD_BOTTOM + 13}
                textAnchor="middle"
                fill="#4b5563"
                fontSize={8}
                fontFamily="monospace"
              >
                {hz}
              </text>
            </g>
          ))}

          <text
            x={PAD_LEFT + graphWidth / 2}
            y={SVG_HEIGHT - 6}
            textAnchor="middle"
            fill="#64748b"
            fontSize={8}
            fontFamily="monospace"
          >
            Frequency (Hz) — µV²/Hz on the vertical axis
          </text>

          <path d={fillPath} fill="rgba(6,182,212,0.16)" className="pointer-events-none" />
          <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth={1.6} className="pointer-events-none" />

          {hover && (
            <g className="pointer-events-none">
              <line
                x1={xFor(hover.hz)}
                y1={PAD_TOP}
                x2={xFor(hover.hz)}
                y2={PAD_TOP + graphHeight}
                stroke="#f87171"
                strokeWidth={1}
                strokeDasharray="3 2"
              />
              <circle cx={xFor(hover.hz)} cy={yFor(hover.value)} r={3.5} fill="#f87171" />
              <rect
                x={Math.max(4, Math.min(SVG_WIDTH - 148, xFor(hover.hz) - 72))}
                y={PAD_TOP + 6}
                width={144}
                height={20}
                rx={4}
                fill="#030712"
                stroke="#374151"
              />
              <text
                x={Math.max(76, Math.min(SVG_WIDTH - 76, xFor(hover.hz)))}
                y={PAD_TOP + 19}
                textAnchor="middle"
                fill="#e5e7eb"
                fontSize={9}
                fontFamily="monospace"
              >
                {hover.hz.toFixed(2)} Hz · {hover.value.toPrecision(3)} µV²/Hz
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="xl:col-span-4 bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-gray-200">Relative band power</h4>
          <p className="text-xs text-gray-400 mt-0.5">
            Each band integrated from the spectrum above, as a share of the total.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {BAND_ORDER.map((band) => {
            const [lo, hi] = EEG_BANDS[band];
            const ratio = ratioFor(band);
            return (
              <div key={band} className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span style={{ color: BAND_COLORS[band] }} className="font-bold capitalize">
                    {band}{" "}
                    <span className="text-gray-600 font-normal">
                      {lo}–{hi}Hz
                    </span>
                  </span>
                  <span className="text-gray-300">
                    {(ratio * 100).toFixed(1)}%
                    <span className="text-gray-600 ml-1.5">
                      {bandPower ? bandPower[band].toFixed(1) : "0"} µV²
                    </span>
                  </span>
                </div>
                <div className="h-2 rounded-full w-full bg-gray-850 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, ratio * 100)}%`, background: BAND_COLORS[band] }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-gray-950 p-2.5 rounded-xl border border-gray-800 flex justify-between items-center text-xs">
          <span className="text-gray-500 font-mono">Total 0.5–50 Hz</span>
          <span className="font-semibold font-mono text-cyan-400">{total.toFixed(1)} µV²</span>
        </div>
      </div>
    </div>
  );
}

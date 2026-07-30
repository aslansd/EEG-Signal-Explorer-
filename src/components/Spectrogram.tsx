import { useEffect, useMemo, useRef, useState } from "react";
import type { EegRecording, ProcessedRecording } from "../types";
import { stft } from "../lib/dsp";

interface SpectrogramProps {
  recording: EegRecording;
  processed: ProcessedRecording;
  selectedChannel: string;
}

const MAX_FREQ = 45;

/** Sample a blue → teal → yellow → red ramp at `t` in [0, 1]. */
function heatColor(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0.0, [4, 10, 30]],
    [0.25, [12, 60, 140]],
    [0.5, [16, 150, 140]],
    [0.72, [200, 200, 60]],
    [0.88, [235, 120, 40]],
    [1.0, [250, 240, 235]],
  ];
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (x >= p0 && x <= p1) {
      const u = (x - p0) / (p1 - p0 || 1);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * u),
        Math.round(c0[1] + (c1[1] - c0[1]) * u),
        Math.round(c0[2] + (c1[2] - c0[2]) * u),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

export default function Spectrogram({ recording, processed, selectedChannel }: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ time: number; hz: number; db: number } | null>(null);

  const fs = recording.sampleRate;

  /**
   * A real short-time Fourier transform of the selected channel.
   *
   * The previous implementation painted the picture from `dp.predictedLabel` — the
   * *name* of the segment — with a table of "if the label is N3, brighten 0.5–3.5
   * Hz". `selectedChannel` was in the effect's dependency array but never read, so
   * choosing a different electrode changed nothing, and filtering could not affect
   * the image either. There was also a `Math.random()` per pixel, so it shimmered
   * on every repaint.
   */
  const spec = useMemo(() => {
    const signal = processed.clean[selectedChannel];
    if (!signal) return null;
    const nfft = fs >= 256 ? 512 : 256;
    const hop = Math.max(8, Math.round(nfft / 8));
    return stft(signal, fs, nfft, hop, MAX_FREQ);
  }, [processed.clean, selectedChannel, fs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spec || !spec.times.length) return;

    const cssWidth = wrapRef.current?.clientWidth ?? 720;
    const cssHeight = 190;
    // Honour devicePixelRatio: the original used a fixed 800x160 backing store
    // stretched by CSS, which was visibly soft on any high-density display.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nFreq = spec.freqs.length;
    const nTime = spec.times.length;
    const image = ctx.createImageData(canvas.width, canvas.height);

    // Clip the colour scale to percentiles so one loud transient does not wash
    // the whole image out.
    const sorted = Float32Array.from(spec.db).sort();
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.floor(sorted.length * 0.995)];
    const span = hi - lo || 1;

    for (let py = 0; py < canvas.height; py++) {
      // Top of the image is the highest frequency.
      const freqIdx = Math.min(nFreq - 1, Math.floor(((canvas.height - 1 - py) / canvas.height) * nFreq));
      for (let px = 0; px < canvas.width; px++) {
        const timeIdx = Math.min(nTime - 1, Math.floor((px / canvas.width) * nTime));
        const value = spec.db[timeIdx * nFreq + freqIdx];
        const [r, g, b] = heatColor((value - lo) / span);
        const offset = (py * canvas.width + px) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [spec]);

  const handleMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !spec || !spec.times.length) return;
    const rect = canvas.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = 1 - (event.clientY - rect.top) / rect.height;

    const nFreq = spec.freqs.length;
    const timeIdx = Math.min(spec.times.length - 1, Math.max(0, Math.floor(xRatio * spec.times.length)));
    const freqIdx = Math.min(nFreq - 1, Math.max(0, Math.floor(yRatio * nFreq)));

    setHover({
      time: spec.times[timeIdx],
      hz: spec.freqs[freqIdx],
      db: spec.db[timeIdx * nFreq + freqIdx],
    });
  };

  const axisLabels = [MAX_FREQ, 30, 20, 10, 1];

  return (
    <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col gap-3 h-full">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-200">Spectrogram — {selectedChannel}</h4>
          <p className="text-xs text-gray-400 mt-0.5">
            {spec
              ? `${spec.times.length} frames, ${spec.freqs.length} bins up to ${MAX_FREQ} Hz.`
              : "No data for this channel."}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono bg-gray-950 px-2 py-1 border border-gray-800 rounded-lg text-gray-400">
          <span>low</span>
          <span className="w-16 h-2 rounded-full block" style={{ background: "linear-gradient(90deg,#040a1e,#0c3c8c,#10968c,#c8c83c,#eb7828,#faf0eb)" }} />
          <span>high</span>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full border border-gray-800 rounded-xl bg-gray-950 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="block cursor-crosshair w-full"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        />

        <div className="absolute left-1.5 top-1 bottom-1 flex flex-col justify-between text-[8px] font-mono text-gray-300 pointer-events-none select-none">
          {axisLabels.map((hz) => (
            <span key={hz} className="bg-gray-950/75 px-1 rounded">
              {hz}Hz
            </span>
          ))}
        </div>

        {hover && (
          <div className="absolute top-2 right-2 bg-gray-950/95 border border-cyan-500/50 px-2.5 py-1.5 rounded-lg text-[10px] font-mono shadow-2xl pointer-events-none text-right flex flex-col gap-0.5">
            <span className="text-gray-400">
              t <span className="text-cyan-400 font-semibold">{hover.time.toFixed(2)}s</span>
            </span>
            <span className="text-gray-400">
              f <span className="text-purple-400 font-semibold">{hover.hz.toFixed(1)}Hz</span>
            </span>
            <span className="text-gray-400">
              {/* Genuinely decibels now — the old readout labelled a linear value "dB". */}
              <span className="text-amber-400 font-semibold">{hover.db.toFixed(1)} dB</span>
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px] text-gray-500 font-mono px-1">
        <span>0.0s</span>
        <span>{(recording.durationSeconds / 2).toFixed(1)}s</span>
        <span>{recording.durationSeconds.toFixed(1)}s</span>
      </div>
    </div>
  );
}

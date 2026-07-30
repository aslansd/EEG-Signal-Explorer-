import { useMemo, useState } from "react";
import { LABEL_COLORS } from "../data/presets";
import type { ClassificationResult, EegRecording } from "../types";

interface PredictionTimelineProps {
  recording: EegRecording;
  classification: ClassificationResult | null;
  epochSeconds: number;
}

export default function PredictionTimeline({
  recording,
  classification,
  epochSeconds,
}: PredictionTimelineProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  /**
   * Rendered from the classifier output.
   *
   * These blocks were previously hard-coded JSX per scenario — literal
   * `width: "20%"` divs labelled `WAKE (0-4s)` — duplicating the label spans in
   * the data file. Nothing about them depended on the signal, so they stayed
   * identical no matter what the pipeline did, and any change to the recording
   * length would have silently desynchronised them.
   */
  const epochs = classification?.epochs ?? [];
  const total = recording.durationSeconds || 1;

  const colorFor = (label: string) => LABEL_COLORS[label] ?? "#64748b";

  const summary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of epochs) counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [epochs]);

  const mismatches = epochs.filter((e) => e.truth && e.truth !== e.label).length;

  if (!epochs.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl">
        <h4 className="text-sm font-semibold text-gray-200">Epoch classification</h4>
        <p className="text-xs text-gray-400 mt-1">
          Enable the classifier cell to score {epochSeconds}s epochs.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col gap-3">
      <div className="flex flex-wrap justify-between items-start gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-200">Epoch classification</h4>
          <p className="text-xs text-gray-400 mt-0.5">
            {epochs.length} epochs of {epochSeconds}s, nearest-centroid over log band power.
          </p>
        </div>
        {classification?.accuracy !== null && classification?.accuracy !== undefined && (
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
              classification.accuracy >= 0.9
                ? "bg-emerald-950/50 border-emerald-800 text-emerald-300"
                : classification.accuracy >= 0.7
                  ? "bg-amber-950/50 border-amber-800 text-amber-300"
                  : "bg-red-950/50 border-red-800 text-red-300"
            }`}
          >
            {(classification.accuracy * 100).toFixed(0)}% agreement
            {mismatches > 0 ? ` · ${mismatches} mismatch${mismatches === 1 ? "" : "es"}` : ""}
          </span>
        )}
      </div>

      <div className="relative">
        <div className="flex h-8 w-full rounded-lg overflow-hidden border border-gray-850 bg-gray-950">
          {epochs.map((epoch, idx) => {
            const width = ((epoch.end - epoch.start) / total) * 100;
            const wrong = epoch.truth && epoch.truth !== epoch.label;
            return (
              <button
                key={idx}
                type="button"
                onMouseEnter={() => setHovered(idx)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(idx)}
                onBlur={() => setHovered(null)}
                style={{
                  width: `${width}%`,
                  background: colorFor(epoch.label),
                  // Confidence is visible as opacity, so a hesitant epoch looks it.
                  opacity: 0.35 + epoch.confidence * 0.65,
                }}
                className={`h-full border-r border-gray-950/60 last:border-r-0 relative ${
                  wrong ? "ring-1 ring-inset ring-red-400" : ""
                }`}
                aria-label={`${epoch.start.toFixed(1)} to ${epoch.end.toFixed(1)} seconds: ${epoch.label}, ${(epoch.confidence * 100).toFixed(0)}% confidence`}
              />
            );
          })}
        </div>

        {hovered !== null && epochs[hovered] && (
          <div className="absolute -top-1 left-0 right-0 flex justify-center pointer-events-none z-10">
            <div className="bg-gray-950/97 border border-cyan-500/50 rounded-lg px-3 py-2 shadow-2xl text-[10px] font-mono -translate-y-full flex flex-col gap-0.5">
              <span className="text-gray-400">
                {epochs[hovered].start.toFixed(1)}–{epochs[hovered].end.toFixed(1)}s
              </span>
              <span className="text-gray-200 font-semibold">
                {epochs[hovered].label}{" "}
                <span className="text-cyan-400">
                  {(epochs[hovered].confidence * 100).toFixed(0)}%
                </span>
              </span>
              {epochs[hovered].truth && epochs[hovered].truth !== epochs[hovered].label && (
                <span className="text-red-300">actual: {epochs[hovered].truth}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px] font-mono text-gray-500">
        <span>0s</span>
        <span>{total.toFixed(0)}s</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {summary.map(([label, count]) => (
          <span
            key={label}
            className="flex items-center gap-1.5 text-[10px] font-mono text-gray-300 bg-gray-950 border border-gray-850 px-2 py-1 rounded-lg"
          >
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: colorFor(label) }} />
            {label}
            <span className="text-gray-500">×{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

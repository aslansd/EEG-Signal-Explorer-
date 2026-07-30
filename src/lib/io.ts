/**
 * File import and export.
 *
 * The previous upload control accepted a file, printed "Extracted 8 columns of
 * microvolt potentials" and then threw the file away and regenerated the sleep
 * preset. This module actually reads what the user gives it.
 */

import type { EegRecording, ProcessedRecording, PipelineConfig } from "../types";
import { BAND_ORDER } from "./dsp";

export interface ParseResult {
  recording: EegRecording;
  notes: string[];
}

const TIME_COLUMN_NAMES = new Set(["time", "t", "timestamp", "seconds", "sec", "s", "sample"]);

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      out.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  out.push(current);
  return out.map((v) => v.trim());
}

function detectDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", " "];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = sample.split(d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Parse a delimited text file into a recording.
 *
 * Expects one column per channel and one row per sample. A header row is used
 * for channel names when present. A column named time/t/timestamp is used to
 * infer the sample rate; otherwise `fallbackSampleRate` is assumed and that
 * assumption is reported back rather than hidden.
 */
export function parseDelimitedText(
  text: string,
  fileName: string,
  fallbackSampleRate = 256,
): ParseResult {
  const notes: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) {
    throw new Error("The file needs at least a header row and one row of samples.");
  }

  const delimiter = detectDelimiter(lines[0]);
  notes.push(`Delimiter detected as ${delimiter === "\t" ? "tab" : `"${delimiter}"`}.`);

  const firstCells = splitCsvLine(lines[0], delimiter);
  const firstIsNumeric = firstCells.every((c) => c !== "" && Number.isFinite(Number(c)));

  let headers: string[];
  let dataStart: number;
  if (firstIsNumeric) {
    headers = firstCells.map((_, i) => `Ch${i + 1}`);
    dataStart = 0;
    notes.push("No header row found — channels named Ch1…ChN.");
  } else {
    headers = firstCells.map((h, i) => h.replace(/^"|"$/g, "") || `Ch${i + 1}`);
    dataStart = 1;
  }

  const timeIndex = headers.findIndex((h) => TIME_COLUMN_NAMES.has(h.toLowerCase()));
  const channelIndices = headers
    .map((_, i) => i)
    .filter((i) => i !== timeIndex);

  if (!channelIndices.length) {
    throw new Error("No signal columns found — the file only has a time column.");
  }

  const channels = channelIndices.map((i) => headers[i]);
  const rows: number[][] = [];
  const timeValues: number[] = [];
  let skipped = 0;

  for (let r = dataStart; r < lines.length; r++) {
    const cells = splitCsvLine(lines[r], delimiter);
    if (cells.length < headers.length) {
      skipped++;
      continue;
    }
    const values = channelIndices.map((i) => Number(cells[i]));
    if (values.some((v) => !Number.isFinite(v))) {
      skipped++;
      continue;
    }
    rows.push(values);
    if (timeIndex >= 0) timeValues.push(Number(cells[timeIndex]));
  }

  if (rows.length < 32) {
    throw new Error(`Only ${rows.length} usable rows — need at least 32 samples to analyse.`);
  }
  if (skipped > 0) {
    notes.push(`${skipped} row${skipped === 1 ? "" : "s"} skipped as unparseable.`);
  }

  let sampleRate = fallbackSampleRate;
  if (timeIndex >= 0 && timeValues.length > 8) {
    const deltas: number[] = [];
    for (let i = 1; i < Math.min(timeValues.length, 512); i++) {
      const d = timeValues[i] - timeValues[i - 1];
      if (d > 0) deltas.push(d);
    }
    if (deltas.length) {
      deltas.sort((a, b) => a - b);
      const medianDelta = deltas[deltas.length >> 1];
      if (medianDelta > 0) {
        sampleRate = Math.round(1 / medianDelta);
        notes.push(`Sample rate ${sampleRate} Hz inferred from the "${headers[timeIndex]}" column.`);
      }
    }
  } else {
    notes.push(`No time column — assuming ${sampleRate} Hz. Change it if that is wrong.`);
  }

  if (!Number.isFinite(sampleRate) || sampleRate < 8 || sampleRate > 20000) {
    sampleRate = fallbackSampleRate;
    notes.push(`Inferred sample rate was implausible; using ${sampleRate} Hz instead.`);
  }

  const raw: Record<string, Float32Array> = {};
  channels.forEach((ch, colIdx) => {
    const arr = new Float32Array(rows.length);
    for (let i = 0; i < rows.length; i++) arr[i] = rows[i][colIdx];
    raw[ch] = arr;
  });

  // Values in volts rather than microvolts are a very common export format.
  const peak = Math.max(
    ...channels.map((ch) => {
      let m = 0;
      for (let i = 0; i < raw[ch].length; i++) m = Math.max(m, Math.abs(raw[ch][i]));
      return m;
    }),
  );
  if (peak > 0 && peak < 0.01) {
    for (const ch of channels) {
      for (let i = 0; i < raw[ch].length; i++) raw[ch][i] *= 1e6;
    }
    notes.push("Peak amplitude looked like volts — values scaled by 1e6 to microvolts.");
  }

  const recording: EegRecording = {
    source: "imported",
    scenarioId: null,
    name: fileName,
    channels,
    sampleRate,
    sampleCount: rows.length,
    durationSeconds: rows.length / sampleRate,
    raw,
    reference: null,
    truthMasks: null,
    labels: [],
    seed: 0,
    importNotes: notes,
  };

  return { recording, notes };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "recording";
}

/** Export the cleaned signal, one column per channel, with a time column. */
export function exportCleanedCsv(
  recording: EegRecording,
  processed: ProcessedRecording,
): void {
  const { channels, sampleRate, sampleCount } = recording;
  const parts: string[] = [];
  parts.push(["time_s", ...channels.map((ch) => `${ch}_uV`)].join(","));
  for (let i = 0; i < sampleCount; i++) {
    const row = new Array(channels.length + 1);
    row[0] = (i / sampleRate).toFixed(6);
    for (let c = 0; c < channels.length; c++) {
      row[c + 1] = processed.clean[channels[c]][i].toFixed(4);
    }
    parts.push(row.join(","));
  }
  downloadBlob(
    new Blob([parts.join("\n")], { type: "text/csv;charset=utf-8" }),
    `${safeName(recording.name)}-cleaned.csv`,
  );
}

/** Export the per-channel band power table. */
export function exportBandPowerCsv(
  recording: EegRecording,
  processed: ProcessedRecording,
): void {
  const header = ["channel", ...BAND_ORDER.map((b) => `${b}_uV2`), "total_uV2", "repaired"];
  const rows = processed.bandPower.map((row) =>
    [
      row.channel,
      ...BAND_ORDER.map((b) => row[b].toFixed(4)),
      row.total.toFixed(4),
      row.repaired ? "yes" : "no",
    ].join(","),
  );
  downloadBlob(
    new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" }),
    `${safeName(recording.name)}-band-power.csv`,
  );
}

/** Build a plain-text run record: settings used, log lines, and results. */
export function buildRunReport(
  recording: EegRecording,
  processed: ProcessedRecording,
  config: PipelineConfig,
): string {
  const lines: string[] = [];
  const { metrics, classification } = processed;

  lines.push(`# ${recording.name}`);
  lines.push("");
  lines.push(
    recording.source === "simulated"
      ? `Synthetic recording, seed ${recording.seed}. Not from a human subject.`
      : "Imported recording.",
  );
  lines.push(
    `${recording.channels.length} channels, ${recording.sampleRate} Hz, ${recording.durationSeconds.toFixed(1)} s.`,
  );
  lines.push("");
  lines.push("## Pipeline settings");
  lines.push(`- Notch: ${config.preprocessing.notchFilter ? `${config.preprocessing.notchFrequency} Hz, Q=${config.preprocessing.notchQ}` : "off"}`);
  lines.push(
    `- Bandpass: ${config.preprocessing.bandpassEnabled ? `${config.preprocessing.bandpassMin}–${config.preprocessing.bandpassMax} Hz, order ${config.preprocessing.filterOrder}` : "off"}`,
  );
  lines.push(`- Reference: ${config.preprocessing.reReferencing}`);
  lines.push(`- Normalisation: ${config.preprocessing.normalization} (display only)`);
  lines.push(`- Detection threshold: ${config.artifacts.artifactThreshold}σ`);
  lines.push(
    `- Artifact steps: ${[
      config.artifacts.badChannelRepair && "bad-channel repair",
      config.artifacts.eogRegression && "ocular regression",
      config.artifacts.muscleSuppression && "muscle suppression",
      config.artifacts.ecgTemplateRemoval && "cardiac template",
    ]
      .filter(Boolean)
      .join(", ") || "none"}`,
  );
  lines.push(
    `- Welch: ${config.features.windowSeconds}s window, ${Math.round(config.features.overlap * 100)}% overlap; epochs ${config.features.epochSeconds}s`,
  );
  lines.push("");
  lines.push("## Measured");
  lines.push(`- Heart rate: ${metrics.heartRateBpm === null ? "not detected" : `${metrics.heartRateBpm} bpm`}`);
  lines.push(`- Ocular events: ${metrics.blinkCount}`);
  lines.push(`- Noise floor (>45 Hz RMS): ${metrics.noiseFloorRms.toFixed(2)} µV`);
  lines.push(`- Samples touched by an artifact: ${(metrics.artifactRatio * 100).toFixed(1)}%`);
  if (metrics.recoveryR !== null && metrics.baselineR !== null) {
    lines.push(
      `- Correlation with ground truth: ${metrics.baselineR.toFixed(3)} → ${metrics.recoveryR.toFixed(3)}`,
    );
  }
  if (processed.badChannels.length) {
    lines.push(`- Repaired channels: ${processed.badChannels.join(", ")}`);
  }
  lines.push("");
  lines.push("## Band power (µV²)");
  lines.push(`| channel | ${BAND_ORDER.join(" | ")} | total |`);
  lines.push(`| --- | ${BAND_ORDER.map(() => "---").join(" | ")} | --- |`);
  for (const row of processed.bandPower) {
    lines.push(
      `| ${row.channel} | ${BAND_ORDER.map((b) => row[b].toFixed(2)).join(" | ")} | ${row.total.toFixed(2)} |`,
    );
  }

  if (classification && classification.epochs.length) {
    lines.push("");
    lines.push("## Epoch classification");
    if (classification.accuracy !== null) {
      lines.push(`Agreement with ground truth: ${(classification.accuracy * 100).toFixed(1)}%`);
    }
    lines.push("");
    lines.push("| epoch | predicted | confidence | truth |");
    lines.push("| --- | --- | --- | --- |");
    for (const e of classification.epochs) {
      lines.push(
        `| ${e.start.toFixed(1)}–${e.end.toFixed(1)}s | ${e.label} | ${(e.confidence * 100).toFixed(0)}% | ${e.truth ?? "—"} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Pipeline log");
  for (const entry of processed.log) lines.push(`- ${entry}`);

  return lines.join("\n");
}

export function exportRunReport(
  recording: EegRecording,
  processed: ProcessedRecording,
  config: PipelineConfig,
): void {
  downloadBlob(
    new Blob([buildRunReport(recording, processed, config)], {
      type: "text/markdown;charset=utf-8",
    }),
    `${safeName(recording.name)}-run.md`,
  );
}

/** Rasterise an inline SVG element to a PNG download. */
export async function exportSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
  scale = 2,
  background = "#030712",
): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const viewBox = svg.viewBox.baseVal;
  const width = viewBox && viewBox.width ? viewBox.width : svg.clientWidth || 800;
  const height = viewBox && viewBox.height ? viewBox.height : svg.clientHeight || 450;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const serialised = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([serialised], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not rasterise the chart."));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!pngBlob) throw new Error("Could not encode the PNG.");
    downloadBlob(pngBlob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

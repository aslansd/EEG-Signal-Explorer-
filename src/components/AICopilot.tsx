import { useEffect, useRef, useState } from "react";
import { Brain, ClipboardCopy, Loader, MessageSquare, Sparkles, StopCircle } from "lucide-react";
import type { EegRecording, PipelineConfig, ProcessedRecording } from "../types";
import { buildRunReport } from "../lib/io";

interface AICopilotProps {
  recording: EegRecording;
  processed: ProcessedRecording;
  config: PipelineConfig;
}

interface HealthInfo {
  geminiConfigured: boolean;
  model: string | null;
}

const PRESETS = [
  {
    title: "Explain the spectrum",
    prompt:
      "Explain what the measured band powers and the shape of the power spectrum indicate about this segment, and what a neurophysiologist would look at first.",
  },
  {
    title: "Critique the pipeline",
    prompt:
      "Review the filter and artifact-removal settings that produced these numbers. What is likely being over-corrected or under-corrected, and what would you change?",
  },
  {
    title: "Explain the disagreements",
    prompt:
      "Look at the epoch classification results and the confusion between classes. Which features are most likely driving the mistakes?",
  },
];

/**
 * Renders a very small subset of Markdown safely.
 *
 * Kept deliberately simple and text-only: nothing here injects HTML, so a model
 * response cannot introduce markup into the page.
 */
function renderMarkdown(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("### ")) {
      return (
        <h3 key={i} className="text-xs font-semibold text-emerald-400 mt-3 mb-1">
          {line.slice(4)}
        </h3>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h2 key={i} className="text-sm font-semibold text-purple-400 mt-4 mb-1.5">
          {line.slice(3)}
        </h2>
      );
    }
    if (line.startsWith("# ")) {
      return (
        <h1 key={i} className="text-sm font-bold text-cyan-400 border-b border-gray-800 pb-1 mt-3 mb-2">
          {line.slice(2)}
        </h1>
      );
    }
    if (/^\s*[-*]\s/.test(line)) {
      return (
        <li key={i} className="ml-4 list-disc text-gray-400 mb-0.5">
          {line.replace(/^\s*[-*]\s/, "")}
        </li>
      );
    }
    if (!line.trim()) return <div key={i} className="h-2" />;
    return (
      <p key={i} className="mb-2 text-gray-300">
        {line}
      </p>
    );
  });
}

export default function AICopilot({ recording, processed, config }: AICopilotProps) {
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Ask the server which model it is actually configured with.
   *
   * The badge previously read "Gemini 3.5 Flash" as a hard-coded string in the
   * component while the model name lived separately in server.ts, so the two could
   * drift apart with nothing to catch it.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setHealth({ geminiConfigured: !!data.geminiConfigured, model: data.model ?? null });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async (text: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 60_000);

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        // Send the compiled run record rather than dozens of loose fields, so the
        // model sees exactly the numbers the user is looking at.
        body: JSON.stringify({
          userPrompt: text,
          runReport: buildRunReport(recording, processed, config),
          isSynthetic: recording.source === "simulated",
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
      setReport(data.report ?? "");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setError("The request was cancelled or timed out after 60 seconds.");
      } else {
        setError((err as Error).message || "Could not reach the interpretation endpoint.");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("The browser blocked clipboard access.");
    }
  };

  const disabled = health ? !health.geminiConfigured : false;

  return (
    <div className="bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="bg-gradient-to-tr from-cyan-500 to-indigo-600 p-2.5 rounded-xl text-white shrink-0">
          <Brain className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-200 flex flex-wrap items-center gap-2">
            Interpretation assistant
            <span className="flex items-center gap-1 text-[9px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-900 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold">
              <Sparkles className="w-2.5 h-2.5" />
              {health?.model ?? "checking…"}
            </span>
          </h3>
          <p className="text-xs text-gray-400">
            Sends the current run record — settings, measurements and epoch results — for a written
            explanation.
          </p>
        </div>
      </div>

      {/*
        The original offered to draft clinical referral letters from simulated data
        with no indication anywhere that the recording was not from a person.
      */}
      {recording.source === "simulated" && (
        <p className="text-[11px] text-amber-200/90 bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2">
          This recording is synthetic, generated from seed {recording.seed}. Anything written about it
          describes a simulation, not a patient, and is not clinical advice.
        </p>
      )}

      {disabled && (
        <p className="text-[11px] text-gray-300 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2">
          No API key is configured on the server, so this panel is inactive. Everything else in the
          workspace runs locally in the browser and is unaffected.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.title}
            type="button"
            onClick={() => generate(preset.prompt)}
            disabled={loading || disabled}
            className="p-3 rounded-xl border border-gray-800 bg-gray-950 hover:bg-gray-900/60 hover:border-cyan-800 transition-colors text-left text-xs text-gray-300 hover:text-cyan-300 disabled:opacity-40 disabled:hover:border-gray-800"
          >
            {preset.title}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col bg-gray-950 border border-gray-850 rounded-xl overflow-hidden min-h-[180px]">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-xs">
            <Loader className="w-6 h-6 animate-spin text-cyan-400" />
            <p className="font-mono text-cyan-300/80">Waiting for the model…</p>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-red-300 transition-colors"
            >
              <StopCircle className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2">
            <p className="font-mono text-xs text-red-300 max-w-md">{error}</p>
            <p className="text-[11px] text-gray-500 max-w-sm">
              The rest of the workspace does not depend on this endpoint.
            </p>
          </div>
        ) : report ? (
          <>
            <div className="flex justify-between items-center bg-gray-900/80 px-4 py-2 border-b border-gray-850 text-xs text-gray-400">
              <span className="font-mono">Interpretation</span>
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
              >
                <ClipboardCopy className="w-3.5 h-3.5" />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto text-xs leading-relaxed max-h-[320px]">
              {renderMarkdown(report)}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-2">
            <Brain className="w-8 h-8 text-gray-700" />
            <p className="text-xs text-gray-500 max-w-xs leading-normal">
              Pick a question above, or ask your own.
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = prompt.trim();
          if (trimmed) {
            generate(trimmed);
            setPrompt("");
          }
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={loading || disabled}
            placeholder="Ask about these results"
            aria-label="Ask about these results"
            className="w-full bg-gray-950 text-xs text-gray-300 border border-gray-800 hover:border-gray-700 focus:border-cyan-500 rounded-xl pl-9 pr-4 py-2.5 outline-none transition-colors placeholder:text-gray-600 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={loading || disabled || !prompt.trim()}
          className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 rounded-xl text-xs font-medium transition-colors disabled:opacity-30"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

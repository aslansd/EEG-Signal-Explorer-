import React, { useState } from "react";
import { Sparkles, Brain, Loader, MessageSquare, ArrowUpRight, ClipboardCopy } from "lucide-react";
import { PreprocessingConfig, ArtifactRemovalConfig, SpectralBandPower } from "../types";

interface AICopilotProps {
  scenarioName: string;
  activeLabel: string;
  globalMetrics: {
    averageHeartRate?: number;
    blinkCount: number;
    noiseLevel: number;
    overallArtifactRatio: number;
  };
  bandPower: SpectralBandPower[];
  preprocessing: PreprocessingConfig;
  artifacts: ArtifactRemovalConfig;
}

export default function AICopilot({
  scenarioName,
  activeLabel,
  globalMetrics,
  bandPower,
  preprocessing,
  artifacts,
}: AICopilotProps) {
  const [report, setReport] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [error, setError] = useState<string>("");

  const presetPrompts = [
    {
      title: "Physiological Summary",
      prompt: "Draft a formal clinical EEG summary describing the dominant frequency bands and their physiological meaning in this state.",
    },
    {
      title: "Evaluate Preprocessing",
      prompt: "Assess the signal cleaning pipeline. How effective are our artifact removal choices (autoencoder, notch filter) on temporal muscle noise and frontal blinks?",
    },
    {
      title: "Clinical Letter Draft",
      prompt: "Draft an formal referral letter outlining our findings, classification predictions, and recommended clinical follow-ups (e.g. polysomnography or neurologist review).",
    },
  ];

  const handleGenerateReport = async (promptText: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioName,
          activeState: activeLabel,
          bandPowers: bandPower,
          globalMetrics,
          preprocessing,
          artifacts,
          userPrompt: promptText,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to generate report.");
      }

      setReport(data.report);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred. Verify the server is running and the Gemini API Key is configured.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyReport = () => {
    navigator.clipboard.writeText(report);
  };

  return (
    <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl shadow-xl flex flex-col gap-5 h-full" id="ai-clinical-copilot">
      {/* Copilot Header */}
      <div className="flex items-center gap-3">
        <div className="bg-gradient-to-tr from-cyan-500 to-indigo-600 p-2.5 rounded-xl text-white shadow-lg shadow-cyan-500/10">
          <Brain className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-200 flex items-center gap-2">
            ML-Assisted Diagnostic Copilot
            <span className="flex items-center gap-1 text-[9px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-900 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold">
              <Sparkles className="w-2.5 h-2.5 animate-pulse" />
              Gemini 3.5 Flash
            </span>
          </h3>
          <p className="text-xs text-gray-400">Generates real-time, context-aware neurophysiological interpretation reports.</p>
        </div>
      </div>

      {/* Suggestion Chips */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {presetPrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleGenerateReport(p.prompt)}
            disabled={loading}
            className="flex items-start justify-between p-3 rounded-xl border border-gray-800 bg-gray-950 hover:bg-gray-900/60 hover:border-cyan-800 transition-all text-left text-xs text-gray-300 hover:text-cyan-300 disabled:opacity-40 select-none group"
          >
            <span>{p.title}</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-gray-500 group-hover:text-cyan-400 transition-colors shrink-0 mt-0.5" />
          </button>
        ))}
      </div>

      {/* Output Screen */}
      <div className="flex-1 flex flex-col bg-gray-950 border border-gray-850 rounded-xl overflow-hidden min-h-[220px]">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-xs gap-3 p-6">
            <Loader className="w-6 h-6 animate-spin text-cyan-400" />
            <p className="font-mono text-cyan-300/80 animate-pulse">Running advanced Gemini cognitive analysis cell...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-red-400 text-xs gap-2">
            <span className="text-xl">⚠️</span>
            <p className="font-mono font-bold max-w-sm">{error}</p>
            <p className="text-gray-500 max-w-xs mt-1">Please ensure your API key is correctly added inside the Settings Secrets panel.</p>
          </div>
        ) : report ? (
          <div className="flex-1 flex flex-col justify-between">
            {/* Header tools */}
            <div className="flex justify-between items-center bg-gray-900/80 px-4 py-2 border-b border-gray-850 text-xs text-gray-400 select-none">
              <span className="font-mono">Neurophysiologist Consultation Note</span>
              <button
                onClick={handleCopyReport}
                className="flex items-center gap-1 hover:text-cyan-400 text-gray-400 transition-colors"
                title="Copy report markdown to clipboard"
              >
                <ClipboardCopy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </button>
            </div>
            {/* Scrollable Report Content */}
            <div className="flex-1 p-5 overflow-y-auto text-xs text-gray-300 leading-relaxed max-h-[300px] font-sans">
              <div className="prose prose-invert prose-xs max-w-none">
                {/* Clean inline HTML formatted markdown rendering helper */}
                {report.split("\n").map((line, lIdx) => {
                  if (line.startsWith("# ")) {
                    return <h1 key={lIdx} className="text-base font-bold text-cyan-400 border-b border-gray-800 pb-1 mt-4 mb-2">{line.replace("# ", "")}</h1>;
                  } else if (line.startsWith("## ")) {
                    return <h2 key={lIdx} className="text-sm font-semibold text-purple-400 mt-4 mb-2">{line.replace("## ", "")}</h2>;
                  } else if (line.startsWith("### ")) {
                    return <h3 key={lIdx} className="text-xs font-semibold text-emerald-400 mt-3 mb-1">{line.replace("### ", "")}</h3>;
                  } else if (line.startsWith("- ") || line.startsWith("* ")) {
                    return <li key={lIdx} className="ml-4 list-disc text-gray-400 mb-0.5">{line.substring(2)}</li>;
                  } else if (line.trim() === "") {
                    return <div key={lIdx} className="h-2" />;
                  } else {
                    return <p key={lIdx} className="mb-2 text-gray-300 font-sans">{line}</p>;
                  }
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-gray-500 text-xs gap-2 select-none">
            <Brain className="w-8 h-8 text-gray-700 stroke-[1.25]" />
            <p className="max-w-xs leading-normal">No report has been drafted yet. Choose a preset query template above or enter a custom prompt below to run AI segment parsing.</p>
          </div>
        )}
      </div>

      {/* Prompt Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (customPrompt.trim()) {
            handleGenerateReport(customPrompt);
            setCustomPrompt("");
          }
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            disabled={loading}
            placeholder="Ask anything (e.g. 'explain K-complex significance in N2')"
            className="w-full bg-gray-950 text-xs text-gray-300 border border-gray-800 hover:border-gray-700 focus:border-cyan-500 rounded-xl pl-9 pr-4 py-2.5 outline-none transition-all placeholder:text-gray-600"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !customPrompt.trim()}
          className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 rounded-xl text-xs font-medium font-mono disabled:opacity-30 disabled:hover:bg-cyan-600 flex items-center justify-center gap-1 shrink-0 transition-colors cursor-pointer"
        >
          <span>Ask</span>
        </button>
      </form>
    </div>
  );
}

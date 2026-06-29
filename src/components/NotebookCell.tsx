import React, { useState } from "react";
import { Play, CheckCircle2, AlertCircle, Terminal, Cpu, Sliders, Settings2 } from "lucide-react";

interface NotebookCellProps {
  id: string;
  title: string;
  codeSnippet: string;
  status: "idle" | "running" | "success" | "error";
  onRun: () => void;
  children?: React.ReactNode;
  consoleLogs: string[];
}

export default function NotebookCell({
  id,
  title,
  codeSnippet,
  status,
  onRun,
  children,
  consoleLogs,
}: NotebookCellProps) {
  const [showCode, setShowCode] = useState<boolean>(true);

  return (
    <div
      className={`border rounded-2xl overflow-hidden shadow-md transition-all duration-300 ${
        status === "running"
          ? "border-cyan-500 ring-1 ring-cyan-500/20 bg-gray-900/90"
          : status === "success"
          ? "border-emerald-800/80 bg-gray-900/40 hover:bg-gray-900/60"
          : "border-gray-800 bg-gray-900/25 hover:bg-gray-900/45"
      }`}
      id={`notebook-cell-${id}`}
    >
      {/* Cell Header */}
      <div className="flex justify-between items-center bg-gray-950/80 px-5 py-3 border-b border-gray-800/50">
        <div className="flex items-center gap-3">
          {/* Notebook line prompt indicator: [In: 1] */}
          <span className="text-[10px] font-mono text-gray-500 font-bold tracking-wider select-none bg-gray-900 border border-gray-800 px-1.5 py-0.5 rounded">
            In [{status === "running" ? "●" : status === "success" ? "✓" : " "}]
          </span>
          <h4 className="text-xs font-semibold text-gray-300 font-sans tracking-wide">{title}</h4>
        </div>

        <div className="flex items-center gap-2">
          {/* Status badge */}
          {status === "running" && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 bg-cyan-950/50 border border-cyan-800 px-2 py-0.5 rounded-full">
              <Cpu className="w-3 h-3 animate-spin" />
              Computing...
            </span>
          )}
          {status === "success" && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="w-3 h-3" />
              Complete
            </span>
          )}
          {status === "idle" && (
            <span className="text-[10px] font-mono text-gray-500 bg-gray-900 border border-gray-800 px-2 py-0.5 rounded-full">
              Ready
            </span>
          )}

          {/* Toggle Code / Pipeline Parameters Button */}
          <button
            onClick={() => setShowCode(!showCode)}
            className="text-[10px] font-mono text-gray-400 hover:text-cyan-400 bg-gray-900 border border-gray-800 hover:border-cyan-800 px-2.5 py-0.5 rounded-lg transition-all"
          >
            {showCode ? "Show params" : "View python code"}
          </button>

          {/* Play/Run Cell Button */}
          <button
            onClick={onRun}
            disabled={status === "running"}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
              status === "running"
                ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                : "bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer hover:shadow-lg hover:shadow-cyan-500/15"
            }`}
          >
            <Play className="w-3 h-3 fill-current" />
            Run Cell
          </button>
        </div>
      </div>

      {/* Cell Content: Displays either Python code or Parameters UI */}
      <div className="p-5">
        {showCode ? (
          <div className="relative group bg-gray-950/90 border border-gray-800/80 rounded-xl p-3.5 font-mono text-xs overflow-x-auto text-gray-300">
            {/* Syntax highlight code block */}
            <pre className="whitespace-pre">{codeSnippet}</pre>
            <div className="absolute top-2 right-2 text-[8px] uppercase tracking-wider text-gray-600 font-bold select-none group-hover:text-cyan-500/40 transition-colors">
              Python Cell
            </div>
          </div>
        ) : (
          <div className="bg-gray-950/40 border border-gray-850/60 p-4 rounded-xl flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium mb-1 font-sans">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Cell Pipeline Controls</span>
            </div>
            {children}
          </div>
        )}
      </div>

      {/* Terminal Console Logs */}
      {consoleLogs.length > 0 && (
        <div className="bg-gray-950 border-t border-gray-800/80 p-3.5 font-mono text-[11px] text-gray-400 max-h-36 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-2">
            <Terminal className="w-3 h-3 text-emerald-500" />
            <span>MNE-Python Console Output</span>
          </div>
          <div className="flex flex-col gap-1">
            {consoleLogs.map((log, index) => (
              <div key={index} className="flex gap-2 leading-relaxed">
                <span className="text-gray-600 select-none">[{index + 1}]</span>
                <span className={log.startsWith("ERROR") ? "text-red-400" : log.includes("Inference") || log.includes("Welch") ? "text-cyan-300/90" : "text-gray-400"}>
                  {log}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

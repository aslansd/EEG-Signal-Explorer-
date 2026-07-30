import { useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Cpu, Play, Sliders, Terminal } from "lucide-react";
import type { CellStatus } from "../types";

interface NotebookCellProps {
  id: string;
  index: number;
  title: string;
  subtitle?: string;
  codeSnippet: string;
  status: CellStatus;
  onRun: () => void;
  children?: ReactNode;
  consoleLogs: string[];
}

const STATUS_STYLES: Record<CellStatus, string> = {
  running: "border-cyan-500 ring-1 ring-cyan-500/20 bg-gray-900/90",
  success: "border-emerald-800/80 bg-gray-900/40",
  stale: "border-amber-700/70 bg-gray-900/40",
  error: "border-red-800 bg-gray-900/50",
  idle: "border-gray-800 bg-gray-900/25",
};

export default function NotebookCell({
  id,
  index,
  title,
  subtitle,
  codeSnippet,
  status,
  onRun,
  children,
  consoleLogs,
}: NotebookCellProps) {
  const [showCode, setShowCode] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);

  return (
    <section
      /**
       * `shrink-0` is load-bearing.
       *
       * This cell lives in a `flex flex-col` column that has a `max-height`. Flex
       * items in a column container get `min-height: auto`, which normally resolves
       * to the item's content size and stops it collapsing — but the spec makes it
       * resolve to 0 when the item's computed `overflow` is not `visible`. The
       * `overflow-hidden` below (needed to clip the rounded corners) therefore let
       * the browser squeeze every cell down to share the capped height, clipping the
       * body. The toggle button looked broken because it was swapping content inside
       * a box with no room to render it.
       */
      className={`shrink-0 border rounded-2xl overflow-hidden shadow-md transition-colors ${STATUS_STYLES[status]}`}
      id={`notebook-cell-${id}`}
      aria-label={title}
    >
      <header className="flex flex-wrap gap-2 justify-between items-center bg-gray-950/80 px-4 py-3 border-b border-gray-800/50">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[10px] font-mono text-gray-500 font-bold select-none bg-gray-900 border border-gray-800 px-1.5 py-0.5 rounded">
            In [{status === "running" ? "*" : index}]
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-gray-200 truncate">{title}</h3>
            {subtitle && <p className="text-[10px] text-gray-500 truncate">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status === "running" && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 bg-cyan-950/50 border border-cyan-800 px-2 py-0.5 rounded-full">
              <Cpu className="w-3 h-3 animate-spin" />
              Running
            </span>
          )}
          {status === "success" && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="w-3 h-3" />
              Up to date
            </span>
          )}
          {/*
            A "stale" state is the honest answer to a problem the original had:
            changing a control updated the label but nothing recomputed, so the
            cell claimed "Complete" while showing results from older settings.
          */}
          {status === "stale" && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-amber-300 bg-amber-950/40 border border-amber-800 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />
              Settings changed
            </span>
          )}
          {status === "error" && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-red-300 bg-red-950/40 border border-red-800 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />
              Failed
            </span>
          )}

          {/*
            A segmented control rather than one button with a flipping label. With a
            single "Show code" / "Show controls" button there was no way to tell which
            view was active, so a toggle that did nothing visible was indistinguishable
            from a toggle that was broken.
          */}
          <div
            role="group"
            aria-label="Cell view"
            className="flex items-center bg-gray-900 border border-gray-800 rounded-lg p-0.5 text-[10px] font-mono"
          >
            <button
              type="button"
              onClick={() => setShowCode(false)}
              aria-pressed={!showCode}
              className={`px-2 py-0.5 rounded transition-colors ${
                !showCode ? "bg-cyan-600 text-white font-bold" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Controls
            </button>
            <button
              type="button"
              onClick={() => setShowCode(true)}
              aria-pressed={showCode}
              className={`px-2 py-0.5 rounded transition-colors ${
                showCode ? "bg-cyan-600 text-white font-bold" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Code
            </button>
          </div>

          <button
            type="button"
            onClick={onRun}
            disabled={status === "running"}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-mono font-bold transition-colors ${
              status === "running"
                ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                : status === "stale"
                  ? "bg-amber-600 hover:bg-amber-500 text-white"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white"
            }`}
          >
            <Play className="w-3 h-3 fill-current" />
            Run
          </button>
        </div>
      </header>

      <div className="p-4">
        {showCode ? (
          <div className="relative bg-gray-950/90 border border-gray-800/80 rounded-xl p-3.5 font-mono text-[11px] overflow-x-auto text-gray-300">
            <pre className="whitespace-pre">{codeSnippet}</pre>
            <span className="absolute top-2 right-2 text-[8px] uppercase tracking-wider text-gray-600 font-bold select-none">
              Equivalent MNE-Python
            </span>
          </div>
        ) : (
          <div className="bg-gray-950/40 border border-gray-850/60 p-4 rounded-xl flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Parameters</span>
            </div>
            {children}
          </div>
        )}
      </div>

      {consoleLogs.length > 0 && (
        <div className="bg-gray-950 border-t border-gray-800/80">
          <button
            type="button"
            onClick={() => setLogsOpen((v) => !v)}
            aria-expanded={logsOpen}
            className="w-full flex items-center gap-1.5 px-3.5 py-2 text-[9px] uppercase tracking-wider font-bold text-gray-500 hover:text-gray-300 transition-colors"
          >
            <Terminal className="w-3 h-3 text-emerald-500" />
            <span>Output ({consoleLogs.length})</span>
            <ChevronDown
              className={`w-3 h-3 ml-auto transition-transform ${logsOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {logsOpen && (
            <div className="px-3.5 pb-3.5 font-mono text-[11px] max-h-40 overflow-y-auto flex flex-col gap-1">
              {consoleLogs.map((log, i) => (
                <div key={i} className="flex gap-2 leading-relaxed">
                  <span className="text-gray-600 select-none shrink-0">[{i + 1}]</span>
                  <span
                    className={
                      /skipped|clamped|too irregular|not detected|fewer than|unavailable/i.test(log)
                        ? "text-amber-300/90"
                        : /improved|interpolated|beats|events/i.test(log)
                          ? "text-cyan-300/90"
                          : "text-gray-400"
                    }
                  >
                    {log}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors instead of leaving a blank page.
 *
 * The original app had no boundary, so any exception in a chart — a NaN reaching
 * an SVG path attribute, for instance — unmounted the whole tree and showed
 * nothing at all, with the cause only visible in the console.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Render failed:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-950 text-gray-200 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-4">
          <h1 className="text-base font-semibold">Something in the workspace failed to render</h1>
          <p className="text-sm text-gray-400">
            The pipeline state may be inconsistent. Reloading rebuilds the recording from its seed,
            so nothing is lost.
          </p>
          <pre className="text-[11px] font-mono bg-gray-950 border border-gray-850 rounded-lg p-3 overflow-x-auto text-red-300">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="self-start bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

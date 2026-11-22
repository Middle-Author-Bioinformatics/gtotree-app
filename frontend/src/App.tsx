import { useState } from "react";
import { Header } from "./components/Header";
import { SubmitView } from "./components/SubmitView";
import { ResultsView } from "./components/ResultsView";
import { normaliseJobId } from "./lib/jobStore";
import { HAS_BACKEND } from "./lib/gtotree-config";

type View = { kind: "submit" } | { kind: "results"; folder: string };

export default function App() {
  const [view, setView] = useState<View>(() => { const code=normaliseJobId(new URLSearchParams(window.location.search).get("result")||"");return code?{kind:"results",folder:code}:{kind:"submit"}; });

  return (
    <div className="min-h-full relative z-10">
      <Header onTitleClick={() => setView({ kind: "submit" })} />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {!HAS_BACKEND && (
          <div className="panel mb-6 px-4 py-3 text-sm border-warn/40">
            <div className="font-medium text-warn" role="alert">Analysis service unavailable</div>
          </div>
        )}

        {view.kind === "submit" && (
          <SubmitView
            onSubmitted={(folder) => setView({ kind: "results", folder })}
            onLookup={(folder) => setView({ kind: "results", folder })}
          />
        )}
        {view.kind === "results" && (
          <ResultsView
            key={view.folder}
            folder={view.folder}
            onBack={() => setView({ kind: "submit" })}
          />
        )}
      </main>
      <footer className="max-w-7xl mx-auto px-6 py-8 text-[11px] text-fg-faint font-mono">
        © 2026 Middle Author Bioinformatics · For research and educational use only.
      </footer>
    </div>
  );
}

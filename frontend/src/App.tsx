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
            <div className="font-medium text-warn">Preview mode — no backend configured</div>
            <div className="text-fg-muted text-xs mt-1 leading-relaxed">
              This build was deployed without the GToTree env vars set. The UI
              loads but uploads will fail. In Amplify → App settings →
              Environment variables, set:
              <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
                <li><code className="font-mono">VITE_GTOTREE_API_BASE</code> — presign Lambda URL</li>
                <li><code className="font-mono">VITE_GTOTREE_INPUT_BUCKET</code> — S3 bucket for uploads (display only)</li>
                <li><code className="font-mono">VITE_GTOTREE_PUBLIC_RESULTS</code> — public URL of the results bucket</li>
              </ul>
              Then redeploy. See <code className="font-mono">AWS_SETUP.md</code> in the repo.
            </div>
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

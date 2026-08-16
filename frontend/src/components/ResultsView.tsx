import { useEffect, useState } from "react";
import {
  artifactUrl, listResultArtifacts, deriveStatus, fetchTextArtifact,
  type RunStatus, type S3ListEntry,
} from "../lib/gtotree-config";
import { rememberJob } from "../lib/jobStore";
import { StatePill } from "./StatePill";
import { TreeViewer } from "./TreeViewer";
import { cn } from "../lib/utils";
import {
  ArrowLeft, Download, FileText, RefreshCw, Clock, Copy,
  Loader2, ListTree, ScrollText, FileArchive, LayoutDashboard, ExternalLink,
} from "lucide-react";

interface Props {
  folder: string;
  onBack: () => void;
}

export function ResultsView({ folder, onBack }: Props) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [artifacts, setArtifacts] = useState<S3ListEntry[] | null>(null);
  const [artErr, setArtErr] = useState<string | null>(null);
  const [newick, setNewick] = useState<string | null>(null);
  const [logText, setLogText] = useState<string | null>(null);
  const [tab, setTab] = useState<"dashboard" | "tree" | "log" | "files">("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [tabInit, setTabInit] = useState(false);
  const [dlState, setDlState] = useState<"idle" | "working" | "error">("idle");

  async function loadAll() {
    try {
      const objs = await listResultArtifacts(folder);
      setArtifacts(objs);
      setArtErr(null);
      const s = deriveStatus(folder, objs);
      setStatus(s);
      if (s.state !== "pending") {
        rememberJob({ job_id: folder, run_name: null, submitted_at: new Date().toISOString() });
      }
      if (s.treeFile && newick === null) {
        try { setNewick(await fetchTextArtifact(folder, s.treeFile)); } catch { /* */ }
      }
      if (s.logFile && logText === null) {
        try { setLogText(await fetchTextArtifact(folder, s.logFile)); } catch { /* */ }
      }
      // Default to the interactive dashboard when the report exists; otherwise Tree.
      if (!tabInit && s.state !== "pending") {
        setTab(s.reportFile ? "dashboard" : "tree");
        setTabInit(true);
      }
    } catch (e: any) {
      setArtErr(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    loadAll().finally(() => setLoaded(true));
    const terminal = status?.state === "succeeded" || status?.state === "failed";
    const t = setInterval(loadAll, terminal ? 30000 : 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, status?.state]);

  const artifactCount = status?.artifactCount ?? 0;

  if (loaded && status?.state === "pending" && !artErr) {
    return <PendingView folder={folder} onBack={onBack} onRefresh={loadAll} />;
  }

  const copyFolder = async () => { try { await navigator.clipboard.writeText(folder); } catch { /* */ } };

  // Master download: pull the self-contained dashboard HTML (identical to what
  // the Dashboard tab shows) so it can be saved, emailed, and opened offline.
  const downloadReport = async () => {
    if (!status?.reportFile) return;
    setDlState("working");
    try {
      const res = await fetch(artifactUrl(folder, status.reportFile));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GToTree_${folder}_report.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDlState("idle");
    } catch {
      setDlState("error");
      setTimeout(() => setDlState("idle"), 2500);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <section className="panel">
        <div className="panel-bd flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="btn-ghost py-1.5"><ArrowLeft size={14} /> Back</button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">{folder}</h1>
            <div className="text-[11px] font-mono text-fg-muted">
              {artifactCount} artifact{artifactCount === 1 ? "" : "s"} in results bucket
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {status && <StatePill state={status.state} />}
            {status?.reportFile && (
              <button
                onClick={downloadReport}
                disabled={dlState === "working"}
                title="Download the full interactive dashboard as a single self-contained HTML file"
                className="btn-primary py-1.5">
                {dlState === "working"
                  ? <><Loader2 size={14} className="animate-spin" /> Preparing…</>
                  : dlState === "error"
                  ? <><Download size={14} /> Retry download</>
                  : <><Download size={14} /> Download report</>}
              </button>
            )}
            <button onClick={loadAll} className="btn-ghost py-1.5" aria-label="Refresh"><RefreshCw size={14} /></button>
            <button onClick={copyFolder} className="btn-ghost py-1.5"><Copy size={14} /> Copy code</button>
          </div>
        </div>
      </section>

      {artErr && (
        <section className="panel border-danger/40">
          <div className="panel-bd text-sm">
            <div className="text-danger font-medium mb-1">Could not list results</div>
            <div className="text-fg-muted"><code className="font-mono text-[11px]">{artErr}</code></div>
            <div className="text-[11px] text-fg-subtle mt-3 leading-relaxed">
              The results bucket needs <code className="font-mono">s3:ListBucket</code> and{" "}
              <code className="font-mono">s3:GetObject</code> for public reads, and CORS must permit
              GET from this origin. See <code className="font-mono">AWS_SETUP.md</code>.
            </div>
          </div>
        </section>
      )}

      <div className="flex items-center gap-1">
        {status?.reportFile && (
          <TabBtn label="Dashboard" active={tab === "dashboard"} onClick={() => setTab("dashboard")} />
        )}
        <TabBtn label="Tree" active={tab === "tree"} onClick={() => setTab("tree")} />
        <TabBtn label="Run log" active={tab === "log"} onClick={() => setTab("log")} />
        <TabBtn label={artifactCount ? `Files · ${artifactCount}` : "Files"} active={tab === "files"} onClick={() => setTab("files")} />
      </div>

      {tab === "dashboard" && status?.reportFile && <DashboardTab folder={folder} reportFile={status.reportFile} />}
      {tab === "dashboard" && !status?.reportFile && <TreeTab folder={folder} status={status} newick={newick} />}
      {tab === "tree" && <TreeTab folder={folder} status={status} newick={newick} />}
      {tab === "log" && <LogTab logText={logText} status={status} />}
      {tab === "files" && <FilesTab folder={folder} artifacts={artifacts} />}
    </div>
  );
}

function DashboardTab({ folder, reportFile }: { folder: string; reportFile: string }) {
  const url = artifactUrl(folder, reportFile);
  return (
    <section className="panel">
      <div className="panel-hd flex items-center gap-2">
        <LayoutDashboard size={15} className="text-accent" />
        <h3 className="text-sm font-semibold">Interactive dashboard</h3>
        <span className="text-xs font-mono text-fg-muted">{reportFile}</span>
        <a href={url} target="_blank" rel="noreferrer"
          className="ml-auto text-xs text-accent hover:underline inline-flex items-center gap-1">
          <ExternalLink size={12} /> Open in new tab
        </a>
      </div>
      <div className="panel-bd">
        <iframe
          src={url}
          title="GToTree interactive dashboard"
          className="w-full rounded-lg border border-border bg-white"
          style={{ height: "78vh" }}
        />
        <p className="text-[11px] text-fg-subtle mt-2 leading-relaxed">
          Explore and manipulate the tree, view the alignment, the SCG presence heatmap,
          per-genome QC, and the taxonomy sunburst. This is the same self-contained report
          you can download from the Files tab (<span className="font-mono">{reportFile}</span>) and open offline.
        </p>
      </div>
    </section>
  );
}

function TreeTab({ folder, status, newick }:
  { folder: string; status: RunStatus | null; newick: string | null }) {
  if (!status?.treeFile) {
    // No-tree mode or still running
    const alignmentOnly = status?.state === "succeeded" && status?.alignmentFile;
    return (
      <section className="panel">
        <div className="panel-bd text-center text-sm text-fg-muted py-12">
          {alignmentOnly ? (
            <>
              <ListTree className="mx-auto mb-3 text-fg-faint" size={24} />
              This run produced an alignment but no tree (no-tree mode). Download the
              alignment from the Files tab.
            </>
          ) : (
            <>
              <Loader2 className="mx-auto mb-3 animate-spin text-accent" size={20} />
              GToTree is still running — the tree appears here once the Newick file is written.
            </>
          )}
        </div>
      </section>
    );
  }
  if (newick === null) {
    return (
      <section className="panel">
        <div className="panel-bd text-center text-sm text-fg-muted py-12">
          <Loader2 className="mx-auto mb-3 animate-spin text-accent" size={20} />
          Loading tree…
        </div>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="panel-hd">
        <h3 className="text-sm font-semibold">Phylogenomic tree</h3>
        <span className="text-xs font-mono text-fg-muted">{status.treeFile}</span>
      </div>
      <div className="panel-bd">
        <TreeViewer newick={newick} downloadUrl={artifactUrl(folder, status.treeFile)} />
      </div>
    </section>
  );
}

function LogTab({ logText, status }: { logText: string | null; status: RunStatus | null }) {
  if (!status?.logFile) {
    return (
      <section className="panel">
        <div className="panel-bd text-center text-sm text-fg-muted py-12">
          <ScrollText className="mx-auto mb-3 text-fg-faint" size={22} />
          No run log found yet.
        </div>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="panel-hd"><h3 className="text-sm font-semibold">Run log</h3></div>
      <div className="panel-bd">
        <pre className="text-[11px] font-mono bg-surface-3/70 border border-border rounded-lg p-3 overflow-auto whitespace-pre-wrap"
          style={{ maxHeight: "70vh" }}>
          {logText ?? "Loading…"}
        </pre>
      </div>
    </section>
  );
}

function FilesTab({ folder, artifacts }: { folder: string; artifacts: S3ListEntry[] | null }) {
  if (!artifacts) {
    return (
      <section className="panel">
        <div className="panel-bd text-center text-sm text-fg-muted py-12">
          <Loader2 className="mx-auto mb-3 animate-spin text-accent" size={20} /> Listing artifacts…
        </div>
      </section>
    );
  }
  const prefix = `${folder}/`;
  const rows = artifacts
    .filter((e) => e.key.startsWith(prefix) && !e.key.endsWith("/"))
    .filter((e) => !e.key.slice(prefix.length).endsWith("result.json"))
    .sort((a, b) => a.key.localeCompare(b.key));

  if (rows.length === 0) {
    return (
      <section className="panel">
        <div className="panel-bd text-center text-sm text-fg-muted py-12">
          No artifacts yet — files appear here once the tower finishes.
        </div>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="panel-hd">
        <h3 className="text-sm font-semibold">All result files</h3>
        <span className="text-xs text-fg-muted">{rows.length}</span>
      </div>
      <div className="panel-bd">
        <ul className="divide-y divide-border-soft">
          {rows.map((e) => {
            const rel = e.key.slice(prefix.length);
            const isTar = /\.(tar\.gz|tgz|zip)$/i.test(rel);
            return (
              <li key={e.key} className="flex items-center justify-between gap-3 px-1 py-2">
                <span className="text-sm font-mono truncate inline-flex items-center gap-2 min-w-0">
                  {isTar ? <FileArchive size={13} className="text-accent shrink-0" />
                         : <FileText size={13} className="text-accent shrink-0" />}
                  <span className="truncate">{rel}</span>
                  <span className="text-fg-subtle text-[10px] shrink-0">{fmtSize(e.size)}</span>
                </span>
                <a href={artifactUrl(folder, rel)} target="_blank" rel="noreferrer" download
                  className="text-xs text-accent hover:underline inline-flex items-center gap-1 shrink-0">
                  <Download size={12} /> download
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function PendingView({ folder, onBack, onRefresh }:
  { folder: string; onBack: () => void; onRefresh: () => void }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <section className="panel">
        <div className="panel-bd flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost py-1.5"><ArrowLeft size={14} /> Back</button>
          <h1 className="text-lg font-semibold truncate">{folder}</h1>
          <div className="ml-auto flex items-center gap-2">
            <StatePill state="pending" />
            <button onClick={onRefresh} className="btn-ghost py-1.5"><RefreshCw size={14} /></button>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-bd text-sm text-fg-muted py-8 text-center">
          <Clock className="mx-auto mb-3 text-accent" size={28} />
          <div className="font-medium text-fg">Waiting for the GToTree tower to pick up this run.</div>
          <div className="text-xs mt-2 max-w-md mx-auto leading-relaxed">
            No results yet for <span className="font-mono">{folder}</span>. The scraper checks for new
            uploads on a schedule, and a full GToTree run (especially with many accessions to download)
            can take a while — refresh in a few minutes.
          </div>
        </div>
      </section>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn("px-3 py-1.5 rounded-lg text-sm transition-colors",
        active ? "bg-surface-2 text-fg" : "text-fg-muted hover:bg-surface-2/60")}>
      {label}
    </button>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  const u = ["KB", "MB", "GB", "TB"]; let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}

import { DashboardRequest } from "./DashboardRequest";
import { finalState } from "../lib/job-status";
import { useCallback, useEffect, useRef, useState } from "react";
import { isPublicResult } from "../lib/public-results";
import {
  artifactUrl, listResultArtifacts, deriveStatus, fetchTextArtifact, fetchJobState,
  type RunStatus, type S3ListEntry,
} from "../lib/gtotree-config";
import { rememberJob } from "../lib/jobStore";
import { StatePill } from "./StatePill";
import { TreeViewer } from "./TreeViewer";
import { cn } from "../lib/utils";
import { Loader2 } from "lucide-react";

interface Props {
  folder: string;
  onBack: () => void;
}

export function ResultsView({ folder, onBack }: Props) {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [artifacts, setArtifacts] = useState<S3ListEntry[] | null>(null);
  const [artErr, setArtErr] = useState<string | null>(null);
  const [newick, setNewick] = useState<string | null>(null);
  const [tab, setTab] = useState<"dashboard" | "tree" | "files">("dashboard");
  const [jobError,setJobError]=useState("");
  const treeCache = useRef<string | null>(null);
  const requestNumber = useRef(0);
  const [dlState, setDlState] = useState<"idle" | "working" | "error">("idle");

  const loadAll = useCallback(async () => {
    const request = ++requestNumber.current;
    try {
      const [objs,job] = await Promise.all([listResultArtifacts(folder),fetchJobState(folder)]);
      if (request !== requestNumber.current) return null;
      const publicFiles = objs.filter(e => isPublicResult(folder, e.key));
      setArtifacts(publicFiles);
      setArtErr(null);
      const s = deriveStatus(folder, publicFiles);
      s.state=finalState(s.state,!!s.reportFile,job);
      setJobError(job?.state==="failed"?"Analysis failed. Contact MAB with the result code.":(job?.state==="complete"&&job.has_report===false?"The analysis finished without its interactive report.":""));
      setStatus(s);
      if (s.state !== "pending") {
        rememberJob({ job_id: folder, run_name: null, submitted_at: new Date().toISOString() });
      }
      if (s.treeFile && treeCache.current !== s.treeFile) {
        try {
          const text = await fetchTextArtifact(folder, s.treeFile);
          if (request === requestNumber.current && text !== null) {
            treeCache.current = s.treeFile;
            setNewick(text);
          }
        } catch { /* Retry the tree fetch on the next refresh. */ }
      }
      return s.state;
    } catch (e: any) {
      if (request === requestNumber.current) setArtErr("Results could not be loaded. Try refreshing.");
      return null;
    }
  }, [folder]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const state = await loadAll();
      if (!cancelled) {
        if (state !== "succeeded" && state !== "failed") timer = setTimeout(poll, 8000);
      }
    }
    void poll();
    return () => { cancelled = true; ++requestNumber.current; clearTimeout(timer); };
  }, [loadAll]);

  const artifactCount = status?.artifactCount ?? 0;

  const copyLink = async () => {const url=new URL(window.location.href);url.hash="";url.search="";url.searchParams.set("result",folder);try{await navigator.clipboard.writeText(url.href);}catch{/* Copy code remains available. */}};
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
      <DashboardRequest />
      {jobError&&<div className="panel panel-bd text-danger" role="alert">{jobError}</div>}
      <section className="panel">
        <div className="panel-bd flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="btn-ghost py-1.5">Back</button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">{folder}</h1>
            <div className="text-[11px] font-mono text-fg-muted">
              {artifactCount} file{artifactCount === 1 ? "" : "s"}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {status && <StatePill state={status.state} />}
            {status?.reportFile && (
              <button
                onClick={downloadReport}
                disabled={dlState === "working"}
                title="Download report HTML"
                className="btn-primary py-1.5">
                {dlState === "working"
                  ? <><Loader2 size={14} className="animate-spin" /> Preparing…</>
                  : dlState === "error"
                  ? "Retry download"
                  : "Download report"}
              </button>
            )}
            <button onClick={loadAll} className="btn-ghost py-1.5">Refresh</button>
            <button onClick={copyLink} className="btn-ghost py-1.5">Copy result link</button>
            <button onClick={copyFolder} className="btn-ghost py-1.5">Copy code</button>
          </div>
        </div>
      </section>

      {artErr && (
        <section className="panel border-danger/40">
          <div className="panel-bd text-sm">
            <div className="text-danger font-medium mb-1">Could not list results</div>
            <div className="text-fg-muted"><code className="font-mono text-[11px]">{artErr}</code></div>
          </div>
        </section>
      )}

      <div className="flex items-center gap-1">
        {status?.reportFile && (
          <TabBtn label="Dashboard" active={tab === "dashboard"} onClick={() => setTab("dashboard")} />
        )}
        <TabBtn label="Tree" active={tab === "tree" || (tab === "dashboard" && !status?.reportFile)} onClick={() => setTab("tree")} />
        <TabBtn label={artifactCount ? `Files · ${artifactCount}` : "Files"} active={tab === "files"} onClick={() => setTab("files")} />
      </div>

      {tab === "dashboard" && status?.reportFile && <DashboardTab folder={folder} reportFile={status.reportFile} />}
      {tab === "dashboard" && !status?.reportFile && <TreeTab folder={folder} status={status} newick={newick} />}
      {tab === "tree" && <TreeTab folder={folder} status={status} newick={newick} />}
      {tab === "files" && <FilesTab folder={folder} artifacts={artifacts} />}
    </div>
  );
}

function DashboardTab({ folder, reportFile }: { folder: string; reportFile: string }) {
  const url = artifactUrl(folder, reportFile);
  return (
    <section className="panel">
      <div className="panel-hd flex items-center gap-2">
        <h3 className="text-sm font-semibold">Dashboard</h3>
        <span className="text-xs font-mono text-fg-muted">{reportFile}</span>
        <a href={url} target="_blank" rel="noreferrer"
          className="ml-auto text-xs text-accent hover:underline inline-flex items-center gap-1">
          Open in new tab
        </a>
      </div>
      <div className="panel-bd">
        <iframe
          src={url}
          title="GToTree interactive dashboard"
          className="w-full rounded-lg border border-border bg-white"
          style={{ height: "78vh" }}
        />
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
              Alignment only
            </>
          ) : (
            <>
              Tree unavailable
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

function FilesTab({ folder, artifacts }: { folder: string; artifacts: S3ListEntry[] | null }) {
  if (!artifacts) {
    return (
      <section className="panel">
        <div className="panel-bd text-center text-sm text-fg-muted py-12">
          <Loader2 className="mx-auto mb-3 animate-spin text-accent" size={20} /> Loading files…
        </div>
      </section>
    );
  }
  const prefix = `${folder}/`;
  const rows = artifacts
    .filter((e) => isPublicResult(folder, e.key))
    .sort((a, b) => a.key.localeCompare(b.key));

  if (rows.length === 0) {
    return (
      <section className="panel">
        <div className="panel-bd text-center text-sm text-fg-muted py-12">
          No files
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
            return (
              <li key={e.key} className="flex items-center justify-between gap-3 px-1 py-2">
                <span className="text-sm font-mono truncate inline-flex items-center gap-2 min-w-0">
                  <span className="truncate">{rel}</span>
                  <span className="text-fg-subtle text-[10px] shrink-0">{fmtSize(e.size)}</span>
                </span>
                <a href={artifactUrl(folder, rel)} target="_blank" rel="noreferrer" download
                  className="text-xs text-accent hover:underline inline-flex items-center gap-1 shrink-0">
                  Download
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
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

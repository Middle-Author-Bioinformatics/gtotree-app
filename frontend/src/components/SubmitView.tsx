import { useGenomeImport } from "../lib/useGenomeImport";
import { ACCESSION, MAX_REFERENCES, MAX_SELECTION_BYTES, parseSelection, type GenomeSelection } from "../lib/genome-selection";
import { useEffect, useMemo, useState } from "react";
import { Dropzone } from "./Dropzone";
import { AdvancedOptions } from "./AdvancedOptions";
import {
  HAS_BACKEND, MAX_TOTAL_BYTES, generateSlug, buildFormData, uploadRun,
  SCG_GENE_SET_GROUPS, DEFAULT_GENE_SET, INPUT_ACCEPT,
  defaultAdvancedOptions, buildGtotreeFlags,
  type UploadProgress, type UploadItem, type AdvancedOptions as AdvOpts,
} from "../lib/gtotree-config";
import { sanitizeName, fmtBytes } from "../lib/utils";
import { rememberJob, normaliseJobId } from "../lib/jobStore";
import { Loader2 } from "lucide-react";

interface Props {
  onSubmitted: (folder: string) => void;
  onLookup: (folder: string) => void;
}

type Phase = "idle" | "uploading" | "done" | "error";
type AccMode = "paste" | "file";

export function SubmitView({ onSubmitted, onLookup }: Props) {
  const {selection,setSelection,importError,setImportError}=useGenomeImport();
  useEffect(()=>{if(selection){setAccMode("paste");setAccText(selection.genomes.map(g=>g.assembly_accession).join("\n"));}},[selection]);
  async function importSelection(file:File|undefined){if(!file)return;try{if(file.size>MAX_SELECTION_BYTES)throw new Error("Selection file exceeds 1 MB.");setSelection(parseSelection(await file.text()));setImportError("");}catch(e){setImportError(e instanceof Error?e.message:String(e));}}
  // ---- Result-code lookup ----
  const [lookup, setLookup] = useState("");
  const doLookup = () => { const id = normaliseJobId(lookup); if (id) onLookup(id); };

  // ---- Run meta ----
  const [runName, setRunName] = useState("");
  const [geneSet, setGeneSet] = useState(DEFAULT_GENE_SET);

  // ---- Inputs ----
  const [accMode, setAccMode] = useState<AccMode>("paste");
  const [accText, setAccText] = useState("");
  const [accFiles, setAccFiles] = useState<File[]>([]);
  const [fileAccessions,setFileAccessions]=useState<string[]>([]);
  const [fileAccError,setFileAccError]=useState("");
  const [readingAccessions,setReadingAccessions]=useState(false);
  useEffect(()=>{let cancelled=false;const file=accFiles[0];setFileAccessions([]);setFileAccError("");if(!file){setReadingAccessions(false);return;}
    setReadingAccessions(true);
    Promise.resolve().then(async()=>{if(file.size>MAX_SELECTION_BYTES)throw new Error("Accession list exceeds 1 MB.");const refs=[...new Set((await file.text()).split(/[\s,;]+/).map(x=>x.trim().toUpperCase()).filter(Boolean))];if(!refs.length||refs.length>MAX_REFERENCES||refs.some(x=>!ACCESSION.test(x)))throw new Error("Accession files must contain 1–100 unique GCA_/GCF_ accessions.");if(!cancelled)setFileAccessions(refs);}).catch(e=>{if(!cancelled)setFileAccError(e.message||String(e));}).finally(()=>{if(!cancelled)setReadingAccessions(false);});return()=>{cancelled=true;};
  },[accFiles]);
  const [proteinFiles, setProteinFiles] = useState<File[]>([]);
  const [genbankFiles, setGenbankFiles] = useState<File[]>([]);
  const [genomeFiles, setGenomeFiles] = useState<File[]>([]);

  // KO / Pfam optional single-column target files
  const [koFiles, setKoFiles] = useState<File[]>([]);
  const [pfamFiles, setPfamFiles] = useState<File[]>([]);

  // ---- Advanced options ----
  const advDefaults = useMemo(() => defaultAdvancedOptions(), []);
  const [advanced, setAdvanced] = useState<AdvOpts>(() => defaultAdvancedOptions());

  // Parse pasted accessions into a clean list.
  const pastedAccessions = useMemo(
    () => [...new Set(accText.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))],
    [accText],
  );
  const accCount = accMode === "paste" ? pastedAccessions.length : fileAccessions.length;

  const totalBytes = useMemo(
    () => [...accFiles, ...proteinFiles, ...genbankFiles, ...genomeFiles, ...koFiles, ...pfamFiles]
      .reduce((s, f) => s + f.size, 0),
    [accFiles, proteinFiles, genbankFiles, genomeFiles, koFiles, pfamFiles],
  );
  const overCap = totalBytes > MAX_TOTAL_BYTES;
  const capLabel = fmtBytes(MAX_TOTAL_BYTES);

  const extraFlags = useMemo(() => buildGtotreeFlags(advanced), [advanced]);

  // Live command preview.
  const previewCmd = useMemo(() => {
    const parts = ["GToTree"];
    if (accCount > 0) parts.push("-a", "accessions.txt");
    if (proteinFiles.length) parts.push("-A", "protein_files.txt");
    if (genbankFiles.length) parts.push("-g", "genbank_files.txt");
    if (genomeFiles.length) parts.push("-f", "fasta_files.txt");
    parts.push("-H", geneSet);
    if (advanced.ko_targets && koFiles.length) parts.push("-K", sanitizeName(koFiles[0].name));
    if (advanced.pfam_targets && pfamFiles.length) parts.push("-p", sanitizeName(pfamFiles[0].name));
    parts.push(...extraFlags);
    parts.push("-o", (runName.trim() || "GToTree_output").replace(/\s+/g, "_"));
    return parts.join(" ");
  }, [accCount, proteinFiles, genbankFiles, genomeFiles, geneSet, advanced, koFiles, pfamFiles, extraFlags, runName]);

  // ---- Submission state ----
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState("");

  // ---- Validation ----
  const hasAnyInput =
    accCount > 0 || proteinFiles.length > 0 || genbankFiles.length > 0 || genomeFiles.length > 0;
  const geneSetOk = !!geneSet;
  const validAccessions=accMode==="paste"?(pastedAccessions.length<=MAX_REFERENCES&&pastedAccessions.every(a=>ACCESSION.test(a))):(!fileAccError&&!readingAccessions);
  const canSubmit = HAS_BACKEND && geneSetOk && hasAnyInput && validAccessions && !overCap && (phase === "idle" || phase === "error");

  const hints: string[] = [];
  if (!geneSetOk) hints.push("a single-copy gene set");
  if (!hasAnyInput) hints.push("genome input");
  if (overCap) hints.push(`total data under ${capLabel}`);

  async function handleSubmit() {
    if(!canSubmit)return;
    setPhase("uploading");
    setError(null);
    setProgress(null);
    try {
      const slug = generateSlug();
      setFolder(slug);

      const items: UploadItem[] = [];
      const proteinNames = proteinFiles.map((f) => sanitizeName(f.name));
      const genbankNames = genbankFiles.map((f) => sanitizeName(f.name));
      const genomeNames = genomeFiles.map((f) => sanitizeName(f.name));

      // Accessions: either a pasted list (turned into a file) or an uploaded file.
      let accessionsFileName: string | null = null;
      if (accMode === "paste" && pastedAccessions.length) {
        accessionsFileName = "accessions.txt";
        const blob = new File([pastedAccessions.join("\n") + "\n"], accessionsFileName, { type: "text/plain" });
        items.push({ file: blob, name: accessionsFileName });
      } else if (accMode === "file" && accFiles[0]) {
        accessionsFileName = sanitizeName(accFiles[0].name);
        items.push({ file: accFiles[0], name: accessionsFileName });
      }

      proteinFiles.forEach((f, i) => items.push({ file: f, name: proteinNames[i] }));
      genbankFiles.forEach((f, i) => items.push({ file: f, name: genbankNames[i] }));
      genomeFiles.forEach((f, i) => items.push({ file: f, name: genomeNames[i] }));

      const koName = advanced.ko_targets && koFiles[0] ? sanitizeName(koFiles[0].name) : null;
      const pfamName = advanced.pfam_targets && pfamFiles[0] ? sanitizeName(pfamFiles[0].name) : null;
      if (koName) items.push({ file: koFiles[0], name: koName });
      if (pfamName) items.push({ file: pfamFiles[0], name: pfamName });

      let metadataFile:string|null=null;
      if(selection&&accMode==="paste"){
        const used=selection.genomes.filter(g=>pastedAccessions.includes(g.assembly_accession));
        if(used.length){metadataFile="selected-genomes.json";const metadata:GenomeSelection={...selection,genomes:used};items.push({file:new File([JSON.stringify(metadata)],metadataFile,{type:"application/json"}),name:metadataFile});}
      }
      const names=items.map(item=>item.name);
      if(new Set(names).size!==names.length||names.includes("form-data.txt"))throw new Error("Input filenames overlap after normalization. Rename the conflicting files before submitting.");
      const formText = buildFormData({
        name: runName.trim(),
        geneSet,
        accessionsFile: accessionsFileName,
        metadataFile,
        proteinFiles: proteinNames,
        genbankFiles: genbankNames,
        genomeFiles: genomeNames,
        koFile: koName,
        pfamFile: pfamName,
        gtotreeFlags: extraFlags,
      });
      items.push({ file: new File([formText], "form-data.txt", { type: "text/plain" }), name: "form-data.txt" });

      await uploadRun(slug, items, (p) => setProgress(p));
      rememberJob({ job_id: slug, run_name: runName.trim() || null, submitted_at: new Date().toISOString() });
      setPhase("done");
    } catch (e: any) {
      console.error(e);
      setError(String(e?.message ?? e));
      setPhase("error");
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero */}
      <h1 className="sr-only">GToTree</h1>

      <section className="panel"><div className="panel-hd"><h2 className="text-sm font-semibold">TaxonSlueth references</h2></div><div className="panel-bd space-y-3">
        <label className="label">Import selection JSON<input className="field mt-2" type="file" accept=".json,application/json" onChange={e=>{void importSelection(e.target.files?.[0]);e.target.value="";}} /></label>
        {selection&&<p role="status" className="text-sm">Imported {selection.genomes.length} reference genomes. <button className="btn-ghost" onClick={()=>{setSelection(null);setAccText("");}}>Clear selection</button></p>}
        {fileAccError&&<p role="alert" className="text-sm text-danger">{fileAccError}</p>}
        {importError&&<p role="alert" className="text-sm text-danger">{importError}</p>}
        {!validAccessions&&<p role="alert" className="text-sm text-danger">Invalid accession list. Maximum: 100 unique GCA_/GCF_ references.</p>}
      </div></section>
      {/* Result-code lookup */}
      <section className="panel">
        <div className="panel-hd">
          <div className="flex items-center gap-2">
            <div>
              <h2 className="text-sm font-semibold">Results</h2>
            </div>
          </div>
        </div>
        <div className="panel-bd flex flex-col sm:flex-row gap-3">
          <input
            className="field font-mono flex-1"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doLookup(); }}
            aria-label="Result code"
            placeholder="Result code"
          />
          <button type="button" onClick={doLookup} disabled={!lookup.trim()} className="btn-ghost">
            View results
          </button>
        </div>
      </section>

      {/* 1 · Run details + gene set */}
      <section className="panel">
        <div className="panel-hd">
          <div>
            <h2 className="text-sm font-semibold">Run</h2>
          </div>
        </div>
        <div className="panel-bd grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="label">Run name</span>
            <input
              className="field"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="Run name"
            />
          </label>
          <label className="block">
            <span className="label flex items-center gap-1.5">
              Single-copy gene set
              <span className="text-danger">*</span>
            </span>
            <select className="field" value={geneSet} onChange={(e) => setGeneSet(e.target.value)}>
              {SCG_GENE_SET_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.sets.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* 2 · Genome inputs */}
      <section className="panel">
        <div className="panel-hd flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold">Genomes</h2>
          </div>
          <div className={`ml-auto text-xs font-mono px-2.5 py-1 rounded-md border ${
            overCap ? "border-danger/40 bg-danger/10 text-danger" : "border-border bg-surface-2 text-fg-muted"
          }`}>
            {fmtBytes(totalBytes)} / {capLabel}
          </div>
        </div>
        <div className="panel-bd space-y-5">
          {/* Accessions */}
          <div>
            <div className="label flex items-center gap-2">
              NCBI assembly accessions (max. 100)
              <span className="text-fg-subtle font-normal">(-a)</span>
              {accCount > 0 && <span className="text-accent">· {accCount}</span>}
            </div>
            <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1 text-xs mb-2">
              <ModeBtn active={accMode === "paste"} onClick={() => setAccMode("paste")}>Paste list</ModeBtn>
              <ModeBtn active={accMode === "file"} onClick={() => setAccMode("file")}>Upload file</ModeBtn>
            </div>
            {accMode === "paste" ? (
              <textarea
                className="field font-mono min-h-[92px]"
                value={accText}
                onChange={(e) => setAccText(e.target.value)}
                aria-label="NCBI assembly accessions"
                placeholder={"GCF_000008865.2\nGCF_000005845.2"}
              />
            ) : (
              <Dropzone
                files={accFiles} setFiles={setAccFiles}
                accept={INPUT_ACCEPT.accessions}
                hint=".txt"
                multiple={false}
              />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <div className="label">Protein FASTA files <span className="text-fg-subtle font-normal">(-A)</span></div>
              <Dropzone files={proteinFiles} setFiles={setProteinFiles}
                accept={INPUT_ACCEPT.protein}
                hint=".faa / .fa / .fasta · one genome per file" multiple />
            </div>
            <div>
              <div className="label">GenBank files <span className="text-fg-subtle font-normal">(-g)</span></div>
              <Dropzone files={genbankFiles} setFiles={setGenbankFiles}
                accept={INPUT_ACCEPT.genbank}
                hint=".gbk / .gb / .gbf / .gbff" multiple />
            </div>
            <div>
              <div className="label">Genome FASTA files <span className="text-fg-subtle font-normal">(-f)</span></div>
              <Dropzone files={genomeFiles} setFiles={setGenomeFiles}
                accept={INPUT_ACCEPT.genome}
                hint=".fa / .fasta / .fna · one genome per file" multiple />
            </div>
          </div>

          {overCap && (
            <div className="flex items-start gap-2 text-xs text-danger">
              <span>Upload limit exceeded: {fmtBytes(totalBytes)} / {capLabel}.</span>
            </div>
          )}
        </div>
      </section>

      {/* 3 · Options */}
      <section className="panel">
        <div className="panel-hd">
          <div>
            <h2 className="text-sm font-semibold">Options</h2>
          </div>
        </div>
        <div className="panel-bd space-y-5">
          <AdvancedOptions options={advanced} setOptions={setAdvanced} defaults={advDefaults} />

          {/* KO / Pfam file slots appear when their advanced toggle is on */}
          {(advanced.ko_targets || advanced.pfam_targets) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {advanced.ko_targets && (
                <div>
                  <div className="label">KO targets file <span className="text-fg-subtle font-normal">(-K)</span></div>
                  <Dropzone files={koFiles} setFiles={setKoFiles} accept=".txt,.tsv"
                    hint="KO IDs (.txt / .tsv)" multiple={false} />
                </div>
              )}
              {advanced.pfam_targets && (
                <div>
                  <div className="label">Pfam targets file <span className="text-fg-subtle font-normal">(-p)</span></div>
                  <Dropzone files={pfamFiles} setFiles={setPfamFiles} accept=".txt,.tsv"
                    hint="Pfam IDs (.txt / .tsv)" multiple={false} />
                </div>
              )}
            </div>
          )}

          {/* Command preview */}
          <div>
            <div className="label flex items-center gap-1.5">
              Command
            </div>
            <pre className="text-[11px] font-mono bg-surface-3/70 border border-border rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all text-fg-muted">
              {previewCmd}
            </pre>
          </div>
        </div>
      </section>

      {/* Submit / progress / done */}
      <section className="panel">
        <div className="panel-bd">
          {phase === "done" ? (
            <SubmittedHero folder={folder} onView={() => onSubmitted(folder)} />
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-xs text-fg-muted flex-1">
                <span className="font-mono text-fg-subtle">gene set:</span>{" "}
                <span className="font-mono">{geneSet}</span>{" · "}
                <span className="font-mono text-fg-subtle">inputs:</span>{" "}
                <span className="font-mono">
                  {[
                    accCount ? `${accCount} acc` : null,
                    proteinFiles.length ? `${proteinFiles.length} prot` : null,
                    genbankFiles.length ? `${genbankFiles.length} gbk` : null,
                    genomeFiles.length ? `${genomeFiles.length} fna` : null,
                  ].filter(Boolean).join(", ") || "—"}
                </span>
                {phase === "idle" && !canSubmit && hints.length > 0 && (
                  <div className="text-warn mt-1.5">Required: {hints.join(", ")}.</div>
                )}
                {phase === "error" && error && (
                  <div className="mt-2 flex items-start gap-2 text-danger">
                    <span className="font-mono text-[12px] leading-snug">{error}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || !HAS_BACKEND}
                className="btn-primary">
                {phase === "uploading"
                  ? (<><Loader2 size={16} className="animate-spin" /> Uploading…</>)
                  : "Submit run"}
              </button>
            </div>
          )}

          {phase === "uploading" && progress && (
            <div className="mt-4 space-y-2 animate-fade-in">
              <div className="flex justify-between text-xs text-fg-muted font-mono">
                <span className="truncate mr-3">{progress.currentFile}</span>
                <span>{progress.percent}% · {progress.filesDone}/{progress.filesTotal}</span>
              </div>
              <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div className="h-full bg-leaf-gradient transition-[width] duration-200"
                  style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
        </div>
      </section>

      <p className="text-xs text-fg-faint"><a href="https://doi.org/10.1093/bioinformatics/btz188" target="_blank" rel="noreferrer" className="hover:underline">GToTree · Lee (2019), Bioinformatics</a></p>
    </div>
  );
}

// ===========================================================================
function SubmittedHero({ folder, onView }: { folder: string; onView: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(folder); setCopied(true); } catch { /* */ }
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-semibold">Upload complete</span>
      </div>
      <div className="text-[10px] uppercase tracking-[0.2em] font-semibold opacity-85 mb-1">
        Result code
      </div>
      <code className="block font-mono text-xl sm:text-2xl font-bold tracking-wide break-all">{folder}</code>
      <div className="flex gap-2">
        <button onClick={copy} className="text-xs px-3 py-1.5 rounded-md bg-bg/20 hover:bg-bg/30 transition inline-flex items-center gap-1.5">
          {copied ? "Copied" : "Copy code"}
        </button>
        <button onClick={onView} className="text-xs px-3 py-1.5 rounded-md bg-bg/20 hover:bg-bg/30 transition inline-flex items-center gap-1.5">
          View results
        </button>
      </div>
    </div>
  );
}

function ModeBtn({ active, onClick, children }:
  { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-md transition-colors ${
        active ? "bg-surface text-fg shadow-panel" : "text-fg-muted hover:text-fg"
      }`}>
      {children}
    </button>
  );
}

// GToTree Web Server — runtime config + S3 upload/results helpers.
//
// Architecture (mirrors the breseq / BASIL web servers):
//
//   React SPA (Amplify) ──► Lambda (batch presign) ──► presigned S3 PUT URLs
//                       │                            │
//                       └──► PUT inputs + form-data.txt directly
//                            to the input bucket under  <slug>/…
//                                                            │
//                       ┌────────────────────────────────────┘
//                       ▼
//                 The GToTree "tower" (gtotree_processing.py) polls the input
//                 bucket, reads form-data.txt, runs GToTree, and writes results
//                 to the RESULTS bucket under the same <slug>/ prefix:
//                   <slug>/output/<...>.tre        (Newick tree)
//                   <slug>/output/aligned_SCGs.faa (alignment)
//                   <slug>/output/gtotree_output.log, run summary, etc.
//                   <slug>/result.json             (manifest the viewer reads)
//                       │
//                       ▼
//                 React SPA reads results directly from the public-read results
//                 bucket by composing `${publicResults}/<slug>/…`.
//
// All env vars are read at BUILD TIME from Amplify's "Environment variables".

const env = import.meta.env;

export const GT_CONFIG = {
  /** Presign Lambda Function URL (the gtotree-presign function; same contract
   *  as breseq-presign / basil-presign):
   *    POST { slug, files:[{name, content_type}] }
   *      → { slug, bucket, entries:[{file_name, url, headers:{Content-Type}}] }
   *    PUT  <url> with the returned Content-Type header  (one per file) */
  apiBase: (env.VITE_GTOTREE_API_BASE as string | undefined)?.replace(/\/+$/, "") || "",
  /** S3 bucket name for uploads (informational; the Lambda already knows it). */
  inputBucket: (env.VITE_GTOTREE_INPUT_BUCKET as string | undefined) || "",
  /** Public read URL of the results bucket, e.g.
   *  https://midauthorbio-gtotree-results.s3.us-east-2.amazonaws.com */
  publicResults: (env.VITE_GTOTREE_PUBLIC_RESULTS as string | undefined)?.replace(/\/+$/, "") || "",
};

export const HAS_BACKEND = GT_CONFIG.apiBase !== "";

/** Hard cap on total uploaded data across all inputs, in bytes. 1 GB. */
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Result code generator — a flat, URL-safe slug at the bucket root (no subdirs),
// like the breseq/BASIL servers. This IS the result code the user copies.
// ---------------------------------------------------------------------------
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function randomToken(len = 8): string {
  const cryptoObj = (globalThis as any).crypto;
  const out: string[] = [];
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint8Array(len);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < len; i++) out.push(ALPHABET[buf[i] % ALPHABET.length]);
  } else {
    for (let i = 0; i < len; i++)
      out.push(ALPHABET[Math.floor(Math.random() * ALPHABET.length)]);
  }
  return out.join("");
}

/** Generate the flat run slug / result code, e.g. "8fK2qPb4Xm". */
export function generateSlug(len = 10): string {
  return randomToken(len);
}

// ---------------------------------------------------------------------------
// Single-copy gene (SCG) HMM sets — the required `-H` target. These are the
// gene-sets GToTree ships (run `gtt-hmms` to list). Grouped for the dropdown.
// ---------------------------------------------------------------------------
export interface GeneSetGroup {
  label: string;
  sets: string[];
}

export const SCG_GENE_SET_GROUPS: GeneSetGroup[] = [
  {
    label: "Broad",
    sets: ["Universal-Hug-et-al", "Bacteria_and_Archaea", "Bacteria", "Archaea"],
  },
  {
    label: "Phyla / Classes",
    sets: [
      "Actinobacteria", "Alphaproteobacteria", "Bacteroidetes",
      "Betaproteobacteria", "Chlamydiae", "Cyanobacteria",
      "Epsilonproteobacteria", "Firmicutes", "Gammaproteobacteria",
      "Proteobacteria", "Tenericutes",
    ],
  },
];

export const ALL_GENE_SETS: string[] =
  SCG_GENE_SET_GROUPS.flatMap((g) => g.sets);

export const DEFAULT_GENE_SET = "Universal-Hug-et-al";

// ---------------------------------------------------------------------------
// Input types. GToTree accepts genomes in any combination of four forms; three
// are file uploads and one (accessions) is a single-column text file OR a
// pasted list we turn into a file.
// ---------------------------------------------------------------------------
export type InputKind = "accessions" | "protein" | "genbank" | "genome";

export const INPUT_ACCEPT: Record<InputKind, string> = {
  accessions: ".txt,.tsv,.csv",
  protein: ".faa,.fa,.fasta",
  genbank: ".gbk,.gb,.gbf,.gbff",
  genome: ".fa,.fasta,.fna",
};

// ---------------------------------------------------------------------------
// Advanced GToTree options (the `-t/-D/-L`, `-c/-G/-B`, `-T`, `-N/-k/-X`, etc.
// flags from the help menu). Hidden behind a collapsible "Advanced options"
// section. The form-data builder only emits flags changed from their defaults.
// ---------------------------------------------------------------------------
export type OptKind = "number" | "bool" | "text" | "select";

export interface GtOptionDef {
  key: string;
  flag: string;            // GToTree CLI flag, e.g. "-c" or "-T"
  label: string;
  kind: OptKind;
  default: number | boolean | string;
  help: string;
  options?: string[];      // for select
  step?: number;
  min?: number;
  max?: number;
}

export interface GtOptionGroup {
  id: string;
  title: string;
  desc: string;
  options: GtOptionDef[];
}

export const GTOTREE_OPTION_GROUPS: GtOptionGroup[] = [
  {
    id: "taxonomy",
    title: "Taxonomy labels",
    desc: "Add NCBI / GTDB taxonomy to the genome labels in the tree.",
    options: [
      { key: "add_ncbi_tax", flag: "-t", label: "Add NCBI taxonomy", kind: "bool", default: false,
        help: "Add NCBI taxonomy info to sequence headers for genomes with NCBI taxids (mainly -a accessions and GenBank inputs)." },
      { key: "add_gtdb_tax", flag: "-D", label: "Add GTDB taxonomy", kind: "bool", default: false,
        help: "Add Genome Taxonomy Database (GTDB) taxonomy. Only effective for NCBI accession inputs. Can combine with NCBI; accessions not in GTDB get NCBI info with '_NCBI' appended." },
      { key: "tax_ranks", flag: "-L", label: "Taxonomy ranks", kind: "text", default: "Domain,Phylum,Class,Species,Strain",
        help: "Comma-separated ranks to add to labels, e.g. Domain,Phylum,Class,Order,Family,Genus,Species. (Strain is NCBI-only.)" },
    ],
  },
  {
    id: "filtering",
    title: "Filtering",
    desc: "Sequence-length and genome-completeness filtering.",
    options: [
      { key: "seq_length_range", flag: "-c", label: "Sequence length filter (fraction about median)", kind: "number", default: 0.2, min: 0, max: 1, step: 0.05,
        help: "Float 0–1: range about the median length to keep. Median 100 AA with 0.2 keeps seqs 80–120 AA. (DEFAULT=0.2)" },
      { key: "min_hit_fraction", flag: "-G", label: "Min fraction of SCG hits per genome", kind: "number", default: 0.5, min: 0, max: 1, step: 0.05,
        help: "Float 0–1: minimum fraction of the SCG set a genome must hit to be kept. 100 targets, genome hits 49 → removed at 0.5. (DEFAULT=0.5)" },
      { key: "best_hit", flag: "-B", label: "Best-hit mode", kind: "bool", default: false,
        help: "If a SCG has more than one hit in a genome, use the best hit instead of dropping that target for that genome." },
    ],
  },
  {
    id: "tree",
    title: "Tree generation",
    desc: "Treeing program and alignment-only mode.",
    options: [
      { key: "tree_program", flag: "-T", label: "Tree program", kind: "select", default: "FastTreeMP",
        options: ["FastTreeMP", "FastTree", "IQ-TREE"],
        help: "Program for tree generation. FastTreeMP parallelizes; IQ-TREE runs with -mset WAG,LG. (DEFAULT: FastTreeMP if available, else FastTree.)" },
      { key: "no_tree", flag: "-N", label: "Alignment only (no tree)", kind: "bool", default: false,
        help: "Generate the concatenated SCG alignment only; skip building a tree." },
      { key: "keep_alignments", flag: "-k", label: "Keep individual gene alignments", kind: "bool", default: false,
        help: "Keep the individual per-SCG protein alignment files in the output." },
    ],
  },
  {
    id: "search",
    title: "KO / Pfam searching",
    desc: "Optionally search each genome for KO or Pfam targets (single-column files).",
    options: [
      { key: "ko_targets", flag: "-K", label: "KO targets provided", kind: "bool", default: false,
        help: "Enable if you upload a single-column file of KO targets to search each genome for (hit-count table, hit fastas, and iToL files are produced). Upload the file in the KO/Pfam input slot." },
      { key: "pfam_targets", flag: "-p", label: "Pfam targets provided", kind: "bool", default: false,
        help: "Enable if you upload a single-column file of Pfam targets to search each genome for (hit-count table, hit fastas, and iToL files are produced). Upload the file in the KO/Pfam input slot." },
    ],
  },
];
// NOTE: performance flags (-n CPUs, -M MUSCLE threads, -j parallel jobs, -X
// super5, -P http) are intentionally NOT exposed to end users. The tower runs
// GToTree with sensible server-side defaults for those.

export type AdvancedOptions = Record<string, number | boolean | string>;

export function defaultAdvancedOptions(): AdvancedOptions {
  const o: AdvancedOptions = {};
  for (const g of GTOTREE_OPTION_GROUPS)
    for (const def of g.options) o[def.key] = def.default;
  return o;
}

const OPTION_BY_KEY: Record<string, GtOptionDef> = (() => {
  const m: Record<string, GtOptionDef> = {};
  for (const g of GTOTREE_OPTION_GROUPS) for (const d of g.options) m[d.key] = d;
  return m;
})();

/** Build the GToTree CLI flag tokens for every option changed from its default.
 *  Numbers/text/select emit "flag value"; bools emit just the flag when on.
 *  KO/Pfam flags are handled specially (they take the uploaded file name). */
export function buildGtotreeFlags(opts: AdvancedOptions): string[] {
  const flags: string[] = [];
  for (const [key, val] of Object.entries(opts)) {
    const def = OPTION_BY_KEY[key];
    if (!def) continue;
    // KO/Pfam are represented in form-data via their uploaded file, not here.
    if (key === "ko_targets" || key === "pfam_targets") continue;
    if (def.kind === "bool") {
      if (val === true && def.default !== true) flags.push(def.flag);
    } else {
      const isDefault = String(val) === String(def.default);
      if (!isDefault && String(val).trim() !== "") flags.push(`${def.flag} ${val}`);
    }
  }
  return flags;
}

export function countChangedOptions(opts: AdvancedOptions): number {
  let n = 0;
  for (const [key, val] of Object.entries(opts)) {
    const def = OPTION_BY_KEY[key];
    if (!def) continue;
    if (def.kind === "bool") { if (val === true && def.default !== true) n++; }
    else if (String(val) !== String(def.default)) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// form-data.txt builder.
//
// The GToTree tower parses this line-by-line. We keep the original app's
// "Key: value" lines and extend them:
//
//   Name: <run name>                       -> output dir label
//   SCG set: <gene set>                    -> the -H HMM target (REQUIRED)
//   Accessions File: <file|N/A>
//   Protein File: <file>                   (repeated per file)
//   GenBank File: <file>                   (repeated per file)
//   Genome File: <file>                    (repeated per file)
//   KOFile: <file|N/A>                     (single-column KO targets)
//   PfamFile: <file|N/A>                   (single-column Pfam targets)
//   GtotreeFlags: <extra advanced flags, space-joined>
// ---------------------------------------------------------------------------
export interface FormDataInput {
  name: string;
  geneSet: string;
  accessionsFile?: string | null;
  proteinFiles: string[];
  genbankFiles: string[];
  genomeFiles: string[];
  koFile?: string | null;
  pfamFile?: string | null;
  gtotreeFlags: string[];
}

export function buildFormData(f: FormDataInput): string {
  const lines: string[] = [];
  lines.push(`Name: ${f.name.trim() || "GToTree_run"}`);
  lines.push(`SCG set: ${f.geneSet}`);
  lines.push(`Accessions File: ${f.accessionsFile?.trim() || "N/A"}`);
  for (const n of f.proteinFiles) lines.push(`Protein File: ${n}`);
  for (const n of f.genbankFiles) lines.push(`GenBank File: ${n}`);
  for (const n of f.genomeFiles) lines.push(`Genome File: ${n}`);
  lines.push(`KOFile: ${f.koFile?.trim() || "N/A"}`);
  lines.push(`PfamFile: ${f.pfamFile?.trim() || "N/A"}`);
  lines.push(`GtotreeFlags: ${f.gtotreeFlags.join(" ")}`);
  lines.push(`SubmittedAt: ${new Date().toISOString()}`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Presigned-PUT upload — matches the gtotree-presign Lambda (same contract as
// breseq-presign): one POST mints a batch of presigned PUT URLs, then the
// browser PUTs each file directly to S3. No multipart.
// ---------------------------------------------------------------------------
interface PresignEntry { file_name: string; url: string; headers?: Record<string, string>; }
interface PresignResponse { slug: string; bucket: string; entries: PresignEntry[]; }

async function postJson<T>(payload: unknown): Promise<T> {
  if (!GT_CONFIG.apiBase) {
    throw new Error(
      "No backend configured. Set VITE_GTOTREE_API_BASE in Amplify → Environment variables.",
    );
  }
  const res = await fetch(GT_CONFIG.apiBase, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = body?.error || body?.errorMessage || body?.message
                 || raw.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`Presign Lambda call failed (${res.status}): ${detail}`);
  }
  return body as T;
}

export interface UploadProgress {
  currentFile: string;
  filesDone: number;
  filesTotal: number;
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
}

export interface UploadItem {
  file: File;
  /** S3 key relative file name (placed under <slug>/<name>). */
  name: string;
}

function guessContentType(name: string, fallback: string): string {
  if (/\.(faa|fa|fasta|fna|gbk|gb|gbf|gbff|txt|tsv|csv)$/i.test(name)) return "text/plain";
  return fallback || "application/octet-stream";
}

function putWithProgress(
  url: string, file: File | Blob, headers: Record<string, string>,
  onByte: (loaded: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [k, v] of Object.entries(headers || {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onByte(e.loaded); };
    xhr.onload = () =>
      (xhr.status >= 200 && xhr.status < 300)
        ? resolve()
        : reject(new Error(`S3 PUT failed: ${xhr.status} ${xhr.statusText}`));
    xhr.onerror = () => reject(new Error("S3 PUT network error (check bucket CORS)"));
    xhr.send(file);
  });
}

/** Upload a whole run bundle (inputs + form-data.txt) to S3 under `<slug>/`.
 *  One presign call, then a PUT per file, with aggregate progress. */
export async function uploadRun(
  slug: string, items: UploadItem[],
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const totalBytes = items.reduce((s, it) => s + it.file.size, 0);

  const presign = await postJson<PresignResponse>({
    slug,
    files: items.map((it) => ({
      name: it.name,
      content_type: guessContentType(it.name, it.file.type),
    })),
  });
  if (!presign?.entries || !Array.isArray(presign.entries)) {
    throw new Error("Malformed presign response (no entries)");
  }
  const urlByName = new Map(presign.entries.map((e) => [e.file_name, e]));

  let bytesBefore = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const entry = urlByName.get(it.name);
    if (!entry?.url) throw new Error(`No presigned URL returned for ${it.name}`);
    const ctype = entry.headers?.["Content-Type"] || guessContentType(it.name, it.file.type);
    await putWithProgress(entry.url, it.file, { "Content-Type": ctype }, (loaded) => {
      onProgress?.({
        currentFile: it.name, filesDone: i, filesTotal: items.length,
        bytesUploaded: bytesBefore + loaded, totalBytes,
        percent: totalBytes ? Math.round(((bytesBefore + loaded) / totalBytes) * 100) : 0,
      });
    });
    bytesBefore += it.file.size;
    onProgress?.({
      currentFile: it.name, filesDone: i + 1, filesTotal: items.length,
      bytesUploaded: bytesBefore, totalBytes,
      percent: totalBytes ? Math.round((bytesBefore / totalBytes) * 100) : 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Results — read directly from the public-read results bucket.
// ---------------------------------------------------------------------------
export function resultsPrefix(folder: string): string {
  return GT_CONFIG.publicResults ? `${GT_CONFIG.publicResults}/${folder}` : "";
}

export function artifactUrl(folder: string, relPath: string): string {
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  return `${resultsPrefix(folder)}/${encoded}`;
}

export interface S3ListEntry { key: string; size: number; last_modified: string; }

/** List every object under `<folder>/` in the public results bucket. */
export async function listResultArtifacts(folder: string): Promise<S3ListEntry[]> {
  if (!GT_CONFIG.publicResults) {
    throw new Error("No results bucket configured. Set VITE_GTOTREE_PUBLIC_RESULTS.");
  }
  const entries: S3ListEntry[] = [];
  let continuationToken: string | null = null;
  do {
    const params = new URLSearchParams({ "list-type": "2", prefix: `${folder}/` });
    if (continuationToken) params.set("continuation-token", continuationToken);
    const url = `${GT_CONFIG.publicResults}/?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`List failed: ${res.status}`);
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Could not parse S3 list response as XML");
    for (const node of Array.from(doc.querySelectorAll("Contents"))) {
      const key = node.querySelector("Key")?.textContent || "";
      const size = parseInt(node.querySelector("Size")?.textContent || "0", 10);
      const last_modified = node.querySelector("LastModified")?.textContent || "";
      if (key) entries.push({ key, size, last_modified });
    }
    const truncated = doc.querySelector("IsTruncated")?.textContent === "true";
    continuationToken = truncated
      ? (doc.querySelector("NextContinuationToken")?.textContent || null)
      : null;
  } while (continuationToken);
  return entries;
}

export type RunState = "pending" | "running" | "succeeded" | "failed";

export interface RunStatus {
  folder: string;
  state: RunState;
  /** Relative path (under <folder>/) to the Newick tree file, if present. */
  treeFile?: string | null;
  alignmentFile?: string | null;
  logFile?: string | null;
  artifactCount: number;
}

/** Derive run status from the listed artifacts. A run is "done" once a Newick
 *  tree (or, in no-tree mode, the alignment) exists. */
export function deriveStatus(folder: string, entries: S3ListEntry[]): RunStatus {
  const prefix = `${folder}/`;
  const rels = entries
    .filter((e) => e.key.startsWith(prefix))
    .map((e) => e.key.slice(prefix.length))
    .filter((r) => r.length > 0);

  const find = (rx: RegExp) => rels.find((r) => rx.test(r)) || null;

  const treeFile = find(/\.(tre|tree|nwk|newick)$/i);
  const alignmentFile = find(/aligned.*\.(faa|fa|fasta)$/i) || find(/\.(aln|afa)$/i);
  const logFile = find(/\.log$/i) || find(/summary/i);

  let state: RunState = "pending";
  if (treeFile || alignmentFile) state = "succeeded";
  else if (rels.length > 0) state = "running";

  return {
    folder, state, treeFile, alignmentFile, logFile,
    artifactCount: rels.length,
  };
}

/** Fetch a text artifact (e.g. the Newick tree or the log) as a string. */
export async function fetchTextArtifact(folder: string, relPath: string): Promise<string | null> {
  if (!GT_CONFIG.publicResults) return null;
  const url = `${artifactUrl(folder, relPath)}?_=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  try { return await res.text(); } catch { return null; }
}

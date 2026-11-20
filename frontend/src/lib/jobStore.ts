// Client-side recent-jobs cache so users can find their runs again after a
// browser refresh — without needing a login. Falls back to in-memory when
// localStorage isn't available.

export interface RememberedJob {
  job_id: string;          // the run slug == S3 folder key, e.g. "8fK2qPb4Xm"
  run_name?: string | null;
  submitted_at: string;    // ISO
}

const KEY = "gtotree-recent-jobs";
const MAX = 25;

let memoryFallback: RememberedJob[] = [];
function safeRead(): RememberedJob[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x) => x && typeof x.job_id === "string" && typeof x.submitted_at === "string"
    );
  } catch { return memoryFallback; }
}
function safeWrite(v: RememberedJob[]) {
  memoryFallback = v;
  try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

export function rememberJob(job: RememberedJob) {
  const cur = safeRead();
  const next = [
    job,
    ...cur.filter((j) => j.job_id !== job.job_id),
  ].slice(0, MAX);
  safeWrite(next);
}

export function listRememberedJobs(): RememberedJob[] {
  return safeRead();
}

export function forgetJob(job_id: string) {
  safeWrite(safeRead().filter((j) => j.job_id !== job_id));
}

/** Trim stray whitespace / leading hashes so users can paste a folder key. */
export function normaliseJobId(input: string): string {
  const code=input.trim().replace(/^#/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(code)?code:"";
}

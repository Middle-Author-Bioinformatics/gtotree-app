import clsx, { type ClassValue } from "clsx";

export const cn = (...x: ClassValue[]) => clsx(x);

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${u[i]}`;
}

export function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso || "—";
  const diff = (Date.now() - t) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** Sanitise a file name the same way the original breseq dashboard did, so the
 *  S3 keys and the names recorded in form-data.txt stay consistent with what
 *  the tower-side scraper expects. Spaces & odd chars → underscores. */
export function sanitizeName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, "_");
}

// Mirrors the scientific-file policy in gtotree-local/public_results.py.
const SCIENTIFIC_FILES = new Set([
  "GToTree_output.tre", "Aligned_SCGs.faa", "Genomes_summary_info.tsv",
  "SCG_hit_counts.tsv", "selected-genomes.json", "Partitions.txt", "citations.txt", "iToL-colors.txt",
]);
export function isPublicResult(folder: string, key: string): boolean {
  const prefix = `${folder}/`;
  if (!key.startsWith(prefix)) return false;
  const relative = key.slice(prefix.length);
  if (relative === "gtotree-report.html" || relative === "report.html") return true;
  const parts = relative.split("/");
  return (parts.length === 1 && SCIENTIFIC_FILES.has(parts[0])) ||
    (parts.length === 2 && parts[0] === "output" && SCIENTIFIC_FILES.has(parts[1]));
}

// MAB genome-selection contract v1. Keep identical in assembly-grasp-app and gtotree-app.
export const MAX_REFERENCES = 100;
export const MAX_SELECTION_BYTES = 1024 * 1024;
export const ACCESSION = /^GC[AF]_\d+(?:\.\d+)?$/;
export const METADATA_COLUMNS = ["assembly_accession", "organism_name", "infraspecific_name", "biosample",
  "bioproject", "assembly_level", "group", "host", "isolation_source", "geo_loc_name", "country", "dataset_id"];
export interface GenomeSelection {
  version: 1;
  source: "assembly-grasp";
  created_at: string;
  genomes: Record<string, string>[];
}
export function validateSelection(input: unknown): GenomeSelection {
  const d = input as Partial<GenomeSelection> | null;
  if (!d || d.version !== 1 || d.source !== "assembly-grasp" || !Array.isArray(d.genomes) ||
      d.genomes.length < 1 || d.genomes.length > MAX_REFERENCES) {
    throw new Error("Choose between 1 and 100 TaxonSlueth reference genomes.");
  }
  const seen = new Set<string>();
  const genomes = d.genomes.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid genome metadata row.");
    const record: Record<string, string> = {};
    for (const key of METADATA_COLUMNS) {
      const v = row[key];
      if (v !== undefined && (typeof v !== "string" || v.length > 1000 || /[\r\n\x00]/.test(v))) {
        throw new Error(`Invalid ${key} metadata.`);
      }
      if (v) record[key] = v.trim();
    }
    const accession = (record.assembly_accession || "").toUpperCase();
    if (!ACCESSION.test(accession) || seen.has(accession)) throw new Error("Genome accessions must be valid and unique.");
    record.assembly_accession = accession; seen.add(accession);
    return record;
  });
  return { version: 1, source: "assembly-grasp", created_at: typeof d.created_at === "string" ? d.created_at.slice(0,64) : "", genomes };
}
export function parseSelection(text: string): GenomeSelection {
  if (new TextEncoder().encode(text).length > MAX_SELECTION_BYTES) throw new Error("Selection file exceeds 1 MB.");
  return validateSelection(JSON.parse(text));
}
export function recordFromRow(columns: string[], row: string[], datasetId: string): Record<string, string> | null {
  const record: Record<string, string> = {};
  for (const key of METADATA_COLUMNS) {
    const idx = columns.indexOf(key);
    if (idx >= 0 && row[idx]) record[key] = row[idx].replace(/[\r\n\x00]/g, " ").slice(0,1000).trim();
  }
  record.assembly_accession = (record.assembly_accession || "").toUpperCase();
  if (!ACCESSION.test(record.assembly_accession)) return null;
  record.dataset_id = datasetId.slice(0,1000);
  return record;
}
export function addReferences(current: Record<string, string>[], records: Record<string, string>[]): Record<string, string>[] {
  const byId = new Map(current.map(row => [row.assembly_accession, row]));
  for (const row of records) if (!byId.has(row.assembly_accession)) byId.set(row.assembly_accession, row);
  if (byId.size > MAX_REFERENCES) throw new Error("The reference limit is 100. Remove genomes before adding more.");
  return Array.from(byId.values());
}
export function sameBioSample(records: Record<string,string>[]): number {
  const seen = new Set<string>(); let repeats = 0;
  for (const row of records) {
    const sample = row.biosample?.trim();
    if (sample && !/^(na|n\/a|-)$/i.test(sample)) { if (seen.has(sample)) repeats++; seen.add(sample); }
  }
  return repeats;
}
export function newSelection(genomes: Record<string, string>[]): GenomeSelection {
  return validateSelection({version:1,source:"assembly-grasp",created_at:new Date().toISOString(),genomes});
}
export function allowedOrigin(source: string, configured: string): boolean {
  return configured.split(",").some(entry => {
    try { const url = new URL(entry.trim()); return url.origin === source && url.protocol === "https:"; }
    catch { return false; }
  });
}

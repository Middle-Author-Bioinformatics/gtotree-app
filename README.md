# GToTree Web Server (React)

A React + Vite + Tailwind SPA for building phylogenomic trees with
[GToTree](https://github.com/AstrobioMike/GToTree), styled to match the breseq /
BASIL web servers. Genomes upload straight to S3; the tower runs GToTree and the
app reads the resulting tree back from a public results bucket.

## Features

- **Same look & logic as the breseq app** — shared theme, panels, light/dark,
  flat **result code** (no login/email), direct-to-S3 presigned upload.
- **Single-copy gene (SCG) set** picker (the `-H` target).
- **Four genome input types** — NCBI accessions (paste or upload), protein
  FASTAs (`-A`), GenBank files (`-g`), genome FASTAs (`-f`), in any combination.
- **Advanced GToTree options (collapsible)** — taxonomy (`-t/-D/-L`), filtering
  (`-c/-G/-B`), tree program (`-T`), KO/Pfam searches (`-K/-p`), and run settings
  (`-N/-k/-n/-M/-j/-X/-P`). Only changed values are sent; live command preview.
- **100 MiB total upload cap** enforced client-side and checked by the worker.
- **Interactive results dashboard** — the results page has a **Dashboard** tab
  that embeds a self-contained interactive report (styled like the MAB DESeq
  report) with five panels: an explorable **tree** (phylogram/cladogram/radial,
  re-root, collapse/expand, highlight, export SVG/Newick), the concatenated SCG
  **alignment** viewer, an **SCG presence heatmap**, a sortable **genome QC**
  table, and a **taxonomy sunburst**. Plus Tree / Files tabs. Refreshes preserve
  the current tab and mounted report; automatic polling stops at a terminal state.
- **Scientific downloads only** — logs, raw archives and internal JSON are excluded
  from Files. Public errors do not display backend exception details.
- **Offline report** — the same dashboard is baked to a single
  `gtotree-report.html` you can download and open in any browser offline.

## Develop

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in Lambda URL + buckets
npm run dev                  # http://localhost:5173
```

## Build & deploy

```bash
cd frontend && npm run build   # → frontend/dist
```

Host on AWS Amplify (monorepo; `amplify.yml` at repo root, app root `frontend`).
Wire the buckets + Lambda + tower per [`AWS_SETUP.md`](./AWS_SETUP.md).

The production worker is maintained in
[gtotree-local](https://github.com/Middle-Author-Bioinformatics/gtotree-local).
Deploy its companion public-results change and follow its `PUBLIC_RESULTS.md`
cleanup steps for previously published logs/archives. The older `backend/` files
in this repository are reference copies, not the maintained TheBelly worker.

## Layout

- `frontend/` — the React app (Submit + results page with the Dashboard tab)
- `lambda/gtotree_presign.py` — presign Lambda (Function URL)
- `backend/gtotree_worker.py` — the tower (polls input bucket, runs GToTree, writes results, bakes the report)
- `backend/gtotree_report.py` + `backend/report_assets/` — the interactive HTML dashboard generator
- `backend/gtotree_processing.py` — original minimal poller (kept for reference)
- `backend/requirements.txt` — `boto3` (required) + `plotly` (optional)

For research and educational use only. Please cite GToTree:
Lee, M. D. (2019), *Bioinformatics* 35(20):4162–4164.

## TaxonSlueth → GToTree integration

See [ASSEMBLY_GRASP_INTEGRATION.md](ASSEMBLY_GRASP_INTEGRATION.md) for the coordinated rollout, configuration, and validation.

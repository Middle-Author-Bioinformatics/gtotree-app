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
- **1 GB total upload cap** enforced client-side.
- **Interactive tree viewer** — parses the Newick output and renders a
  phylogram/cladogram with zoom and tip highlighting, plus a Run log tab and a
  Files tab to download the tree, alignment, log, and iToL files (for iTOL,
  FigTree, etc.).

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

## Layout

- `frontend/` — the React app
- `lambda/gtotree_presign.py` — presign Lambda (Function URL)
- `backend/gtotree_processing.py` — the tower (polls input bucket, runs GToTree, writes results)

For research and educational use only. Please cite GToTree:
Lee, M. D. (2019), *Bioinformatics* 35(20):4162–4164.

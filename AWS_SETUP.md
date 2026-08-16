# GToTree Web Server — AWS setup (Amplify / S3 / Lambda)

Pure client-side React SPA: the browser uploads inputs directly to S3 through a
presigning Lambda, and reads results directly from the (public-read) results
bucket. Same architecture as the breseq / BASIL web servers.

```
React SPA (Amplify Hosting)
   │  1. POST {slug, files:[{name, content_type}]}
   ├────────────────────────────►  gtotree-presign Lambda (Function URL)
   │  ◄── {entries:[{file_name, url, headers}]}   │  s3:PutObject (presign)
   │                                              │
   │  2. PUT each file to its url ───────────────►  INPUT bucket
   │      (one presigned PUT per file)               (midauthorbio-gtotree-input)
   │
   │      inputs + form-data.txt now live at
   │          s3://midauthorbio-gtotree-input/<slug>/…
   │
   │   ── GToTree tower (gtotree_processing.py) polls the INPUT bucket, reads
   │      form-data.txt, runs GToTree, writes results to the RESULTS bucket ──
   │          s3://midauthorbio-gtotree-results/<slug>/output/…  (tree, alignment, log)
   │          s3://midauthorbio-gtotree-results/<slug>/result.json
   │
   │  3. GET /?list-type=2&prefix=<slug>/   (list artifacts)
   ├────────────────────────────►  RESULTS bucket (public-read)
   │  4. GET <slug>/output/*.tre, gtotree_output.log, …
   ◄────────────────────────────
```

Five things to wire up:

1. **Amplify** — host the SPA + set build-time env vars.
2. **gtotree-presign Lambda** — mint presigned PUT URLs (`lambda/gtotree_presign.py`).
3. **Input bucket CORS** — so the browser can PUT files.
4. **Results bucket public-read + CORS** — so the viewer can list/GET the tree.
5. **Tower IAM** — read the input bucket, write the results bucket.

---

## 1. Amplify Hosting

The app lives in a `frontend/` subfolder, so Amplify treats the repo as a
**monorepo**. The included `amplify.yml` (repo root) uses the required
`applications:` + `appRoot: frontend` format. Set the Amplify **monorepo app
root** to `frontend`.

Add a **SPA rewrite** (App settings → Rewrites and redirects): Source `/<*>` →
Target `/index.html`, Type `404-200`.

**Environment variables** (read at `npm run build`; redeploy after changes):

| Variable | Example |
| --- | --- |
| `VITE_GTOTREE_API_BASE` | `https://xxxx.lambda-url.us-east-2.on.aws` |
| `VITE_GTOTREE_INPUT_BUCKET` | `midauthorbio-gtotree-input` |
| `VITE_GTOTREE_PUBLIC_RESULTS` | `https://midauthorbio-gtotree-results.s3.us-east-2.amazonaws.com` |

If `VITE_GTOTREE_API_BASE` is unset the app runs in **preview mode** (UI loads,
uploads disabled).

---

## 2. gtotree-presign Lambda

Deploy `lambda/gtotree_presign.py`.

- Runtime: Python 3.12 (bundled `boto3`, no deps). Handler: `gtotree_presign.lambda_handler`.
- Environment variables:

  | Variable | Required | Example |
  | --- | --- | --- |
  | `INPUT_BUCKET` | ✅ | `midauthorbio-gtotree-input` |
  | `ALLOWED_ORIGINS` | recommended | `https://main.dXXXX.amplifyapp.com` (comma-separate multiples; add `http://localhost:5173` for dev) |
  | `AWS_REGION_NAME` | optional | `us-east-2` |
  | `URL_EXPIRES_SECONDS` | optional | `3600` |

- **Function URL:** Auth type `NONE`; CORS allow origin = your Amplify domain,
  methods `POST`, headers `content-type`. (The handler also returns its own
  CORS headers and decodes base64 bodies.)
- Copy the Function URL into `VITE_GTOTREE_API_BASE`.

### Lambda execution-role IAM

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "GtotreePresignPut", "Effect": "Allow", "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::midauthorbio-gtotree-input/*" }
  ]
}
```

---

## 3. Input bucket CORS (`midauthorbio-gtotree-input`)

Presigned PUTs go browser→S3, so the bucket must allow the cross-origin PUT. With
single-shot PUTs you do NOT need `ExposeHeaders: ["ETag"]`.

```json
[
  {
    "AllowedOrigins": [
      "https://main.dXXXXXXXX.amplifyapp.com",
      "http://localhost:5173",
      "http://localhost:4173"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

`AllowedHeaders: ["*"]` is required so the browser can send the signed
`Content-Type` header.

---

## 4. Results bucket — public read + CORS (`midauthorbio-gtotree-results`)

The viewer lists + GETs results unauthenticated, so the results bucket must be
publicly readable and listable, with CORS GET.

### 4a. Block Public Access
Permissions → Block public access → uncheck **Block all public access** (needed
for a public bucket policy).

### 4b. Bucket policy (public List + GET)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "PublicList", "Effect": "Allow", "Principal": "*",
      "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::midauthorbio-gtotree-results" },
    { "Sid": "PublicRead", "Effect": "Allow", "Principal": "*",
      "Action": "s3:GetObject", "Resource": "arn:aws:s3:::midauthorbio-gtotree-results/*" }
  ]
}
```

> `s3:ListBucket` is bucket-wide — anyone who knows the bucket URL can enumerate
> result slugs. That matches the BASIL/breseq public-read pattern. If you need
> privacy, use a small list-Lambda instead (as noted in the breseq setup).

### 4c. Results bucket CORS

```json
[
  {
    "AllowedOrigins": [
      "https://main.dXXXXXXXX.amplifyapp.com",
      "http://localhost:5173",
      "http://localhost:4173"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Type", "Last-Modified", "ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

The tower uploads `output/` with `ContentType: text/plain` + `inline` for the
tree/log/alignment so they render (and the SPA can fetch the Newick).

---

## 5. Tower (gtotree_processing.py) IAM

The machine running the tower needs to read the input bucket and write the
results bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadInputs", "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::midauthorbio-gtotree-input",
                   "arn:aws:s3:::midauthorbio-gtotree-input/*"] },
    { "Sid": "WriteResults", "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::midauthorbio-gtotree-results/*" }
  ]
}
```

Env vars honored by the tower: `GTOTREE_INPUT_BUCKET`, `GTOTREE_RESULTS_BUCKET`,
`GTOTREE_DATA_DIR`, `GTOTREE_RESULTS_DIR`, `CONDA_BIN`, `GTOTREE_CONDA_ENV`,
`GTOTREE_MAX_PARALLEL_JOBS`. Run it on a schedule (cron) like the breseq tower.

> **Two worker options in `backend/`:**
> - **`gtotree_worker.py`** (recommended) — FeGenie-style worker with `--once`
>   cron mode, lock file, `status.json` state machine, `raw-results.tar.gz`, and
>   it bakes the interactive **`gtotree-report.html`** dashboard via
>   `gtotree_report.py`. See `backend/README.md`. Needs `boto3` (+ optional
>   `plotly` to inline the heatmap JS): `pip install -r backend/requirements.txt`.
> - **`gtotree_processing.py`** — the original minimal poller (kept for reference).
>
> The React results page has a **Dashboard** tab that embeds
> `gtotree-report.html` in an iframe. Because it is served from the results
> bucket and framed by the Amplify origin, the results-bucket CORS below (GET/HEAD
> from your origin) already covers it — no extra config needed. The file also
> downloads from the Files tab and opens fully offline.

---

## What the frontend writes (form-data.txt contract)

Each run uploads to a flat `<slug>/` prefix in the input bucket:

```
<slug>/form-data.txt
<slug>/accessions.txt          # if accessions provided (pasted or uploaded)
<slug>/<protein>.faa           # 0+ protein files
<slug>/<genbank>.gbff          # 0+ GenBank files
<slug>/<genome>.fna            # 0+ genome files
<slug>/<ko_targets>.txt        # optional (-K)
<slug>/<pfam_targets>.txt      # optional (-p)
```

`form-data.txt`:

```
Name: my_genomes_tree
SCG set: Universal-Hug-et-al          # -> -H (required)
Accessions File: accessions.txt       # or N/A
Protein File: genomeX.faa             # repeated per file
GenBank File: genomeY.gbff            # repeated per file
Genome File: genomeZ.fna              # repeated per file
KOFile: N/A
PfamFile: N/A
GtotreeFlags: -t -D -c 0.3 -T IQ-TREE -j 4   # validated advanced flags
```

The tower turns the Protein/GenBank/Genome lists into GToTree's `-A`/`-g`/`-f`
list files, maps `SCG set` → `-H`, `Accessions File` → `-a`, KO/Pfam → `-K`/`-p`,
splices the validated `GtotreeFlags`, and runs into `<slug>/output/`.

> Security: `GtotreeFlags` is user-controlled text. The tower re-validates every
> token against an allow-list (`gtotree_processing.py → _sanitize_flags`) and
> runs the command as an argv list (no `shell=True`).

---

## Quick checklist

- [ ] Amplify monorepo app root = `frontend`; SPA rewrite added; env vars set
- [ ] gtotree-presign Lambda deployed; `INPUT_BUCKET` + `ALLOWED_ORIGINS` set
- [ ] Lambda Function URL `NONE` + CORS `POST`; URL → `VITE_GTOTREE_API_BASE`
- [ ] Lambda role: `s3:PutObject` on input bucket
- [ ] Input bucket CORS: `PUT` from your origin
- [ ] Results bucket: Block Public Access off; public `GetObject` + `ListBucket`; CORS `GET`
- [ ] Tower IAM: read input, write results; run on a schedule
```

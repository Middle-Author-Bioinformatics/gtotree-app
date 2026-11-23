# TaxonSlueth references + uploaded genomes

This is a coordinated change with `assembly-grasp-app` and `gtotree-local`. It adds a validated v1 reference-selection import, public metadata retention, the shared MAB theme, explicit worker completion states, copyable result links, and a prominent **Request a dashboard for my lab** action.

## Deployment order

1. Deploy the updated `gtotree-local` worker and report assets on TheBelly. The exact existing cron command remains compatible; the long-lived worker must be restarted to load the changes. See that repo's `ASSEMBLY_GRASP_DEPLOYMENT.md`.
2. Deploy this app with `VITE_ASSEMBLY_GRASP_ORIGINS` set to the exact TaxonSlueth HTTPS origin, or a comma-separated list if custom and Amplify origins are both used.
3. Deploy TaxonSlueth with `VITE_GTOTREE_APP_URL` set to this app's deployed HTTPS URL.

No upload Lambda change is needed for this milestone: it already accepts an additional JSON file. The existing S3 buckets and flat result-code layout remain in use. Do not make buckets private until the separate authenticated delivery layer and frontend are ready; this PR does **not** supply that account/privacy layer.

## Input behavior

The automatic handoff accepts messages only from a configured source origin and the original opener window, matching a random handshake nonce. The app also supports a downloaded selection JSON, with a 1 MiB size cap, up to 100 unique GCA/GCF references, bounded metadata strings, and a fixed metadata field allow-list. Unrecognized metadata fields cannot grant ownership or permissions. The same contract is mirrored in both repos.

Users can edit the populated accession list and add their own genomes. Reference metadata is restricted to selected accessions actually submitted in the pasted list; it is omitted if switching to an unrelated accession-file input. Both pasted and uploaded accession lists are checked for valid, unique reference IDs and the 100-reference cap. Uploaded genomes remain additional to those references. The worker enforces total upload bytes, uploaded/combined genome counts, threads, and runtime. Input filenames must remain unique after normalization.

Metadata uploads as `selected-genomes.json` before the final `form-data.txt` job marker. Existing submissions without this field remain compatible. The updated worker produces `output/selected-genomes.json` and embeds a searchable reference-metadata table in its report, clearly distinguished from the genomes that passed QC and were placed in the tree.

## Reports, sharing, and inquiries

New jobs read `status.json`: running/failed states take precedence over partially uploaded or older artifacts, and completion waits for the dashboard. Older reports without status files still work. Existing report codes are retained; **Copy result link** produces an app URL with `?result=CODE` that opens the same report.

These are the existing public/code-based reports, not private account-based sharing. Shared Cognito identity, report ownership, revocable share permissions, and a central report history remain separate work before an account-based public launch.

The inquiry button opens https://midauthorbio.com/#gtotree in a new tab. It does not launch an email client or submit a request itself. Dashboard projects start at $999, with final pricing quoted after scope review. The website form handles the inquiry; no report code or scientific files are sent automatically. The legacy VITE_DASHBOARD_CONTACT_EMAIL setting is no longer used.

## Tests

```bash
cd frontend
npm ci
npm run build
npm run test:selection
npm run test:status
npm run test:ui
```

Tests include malformed imports, origin allow-list checks, reference limits, partial report publication, legacy reports, and actual React form submission with a reference list plus an uploaded genome and retained metadata. React tests run in jsdom with simulated uploads; inspect the Amplify branch preview for visual layout. Real AWS uploads and GToTree jobs are not run by these checks.

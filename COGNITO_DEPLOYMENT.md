# MAB accounts: GToTree deployment

This is the first app integration with the shared MAB account. The existing
Cognito pool is `us-east-2_VzCBot5S3`, the GToTree SPA client is
`6k3o2d5gtns534fcuqdkqgbto8`, and the login domain is
`https://us-east-2vzcbot5s3.auth.us-east-2.amazoncognito.com`.
These are public configuration identifiers, not credentials.

Required: full name, verified email, institution/company and position.
Institution accepts `Independent`. Favorite software and research area are
optional. Cognito collects name/email; the API requires a completed profile
before accepting jobs, listing results or delivering any scientific file.
Any verified member with a complete profile can retrieve any result code.
User profiles and usage records are accessible only to administrators.

## 1. Merge and deploy the new AWS backend

After merging this PR, open AWS CloudShell in **us-east-2** and run:

```bash
git clone https://github.com/Middle-Author-Bioinformatics/gtotree-app.git mab-gtotree-accounts
cd mab-gtotree-accounts
bash accounts/deploy.sh
```

The script creates a private deployment-artifact bucket and the `mab-accounts`
CloudFormation stack: profile, usage-event and job-reservation DynamoDB tables,
an IAM role, and a streaming Lambda URL. It also creates the `mab-admin` Cognito
group if needed. It does not modify the existing input/results buckets, old
upload endpoint, Cognito user pool/client, or The Belly's worker/cron.
For an existing checkout, use `git pull --ff-only` before running the script.

The API URL uses `AuthType: NONE` at the Lambda URL layer because Cognito bearer
tokens, rather than IAM signatures, authenticate every application request in
the handler. Signature, issuer, client, expiry, token type, scope, user identity,
verified email and profile checks all happen before resource access. Only CORS
preflight is unauthenticated. CORS headers are supplied by the handler, not
duplicated in the Function URL configuration.

## 2. Enable the frontend in Amplify

In GToTree's Amplify environment variables, add the two values printed by the
script:

```text
VITE_MAB_AUTH_ENABLED=true
VITE_MAB_API_BASE=<AccountApiUrl printed by deployment>
```

Save and redeploy `main`. The pool ID, client ID and login-domain defaults are
already configured; optional overrides are listed in `frontend/.env.example`.
The existing upload/public-results variables remain available for rollback, but
are never used as a fallback when account mode is enabled. Do not put a client
secret in Amplify: this is a public SPA client.

Cognito callback and sign-out URLs must both match the app origin exactly:
`https://main.d3kklav1el26h6.amplifyapp.com/`. The configured authorization-code
flow uses PKCE and the `openid email profile` scopes. An alternate/custom app
domain must be added to that client's callback/sign-out URLs and the stack's
`AllowedOrigins` before using it.
The input bucket's upload CORS configuration must also allow that origin.

## 3. Test registration and protected access

Create an account, verify its email, and complete the institution/position form.
Leave software/research area empty to confirm they are optional. Check an
existing result code, its interactive report, Files downloads, a small new
submission, sign-out and return to a shared result link after sign-in.

Profile and report API requests must return 401 without an Authorization bearer
token. A verified account with an incomplete profile must receive 403 for
results/uploads. A second completed account must be able to view the same result
code. Normal accounts must receive 403 for `/admin/users`.

At this stage the new API is protected, but the old public S3 URLs and upload
Lambda still exist. The final cutover below closes those paths. Do not describe
the service as account-only until this step is completed and checked.

## 4. Make the existing buckets private

Use the name of the **old upload/presign Lambda**, normally `gtotree-presign`.
Confirm its name in Lambda before running this command; do not use the new
accounts Lambda. First audit, then apply:

```bash
python3 accounts/activate-private-results.py --legacy-presign-function gtotree-presign
python3 accounts/activate-private-results.py --legacy-presign-function gtotree-presign --apply
```

The audit prints the old endpoint URL for verification. Apply saves original
settings under `~/.mab-private/account-cutover/`, changes the old endpoint to
`AWS_IAM`, and enables all four S3 Block Public Access settings on the existing
GToTree input/results buckets. It does not edit/delete result files or bucket
policies, and it leaves IAM access by the accounts API and existing worker in
place. A failure attempts to restore previous settings.

Afterward, repeat the authenticated report/download/submission checks. Old
unsigned S3 report links and the old anonymous upload request must now fail.
Share app links such as `https://main.d3kklav1el26h6.amplifyapp.com/?result=CODE`;
they preserve the code through sign-in. No analyses or report rebuilds are needed.

For rollback, pass the saved JSON path printed by cutover:

```bash
python3 accounts/activate-private-results.py --restore /path/to/saved/settings.json --apply
```

Then disable `VITE_MAB_AUTH_ENABLED` and redeploy. This restores the old public
access model; do not use it as a routine response to an account error. The backup
contains the exact prior settings.

## 5. Give your own account administrator access

After registering your own account, find its **Username** in the Cognito Users
list. In CloudShell, replace `YOUR_COGNITO_USERNAME` and run:

```bash
aws cognito-idp admin-add-user-to-group --region us-east-2 \
  --user-pool-id us-east-2_VzCBot5S3 \
  --username YOUR_COGNITO_USERNAME --group-name mab-admin
```

Sign out and sign in again to refresh group claims. **Account → Users** displays
the private user list; Load more fetches additional pages. Export loaded users
saves those rows as CSV. Self-service profile updates cannot grant admin access.

Usage events record upload authorization, result lookup and file access,
including account ID, app and result code. Upload authorization means a job was
started, not proof that all files arrived or an analysis completed. Raw events
expire after 90 days; profiles keep their latest activity time. Profiles and job
reservations are retained. Tables have a retain policy on stack deletion; access
and deletion of account information remain administrator operations.

## Additional MAB apps

Do not create another user pool. Add a public SPA app client for each app in the
same pool, with its own callback/logout URLs. Add those client IDs and origins to
the existing accounts stack as needed, then integrate each frontend and its
data-access routes. Profiles stay keyed by the same Cognito user ID in the
existing profile table. TaxonSleuth, FeGenie, breseq and BASIL are not changed by
this first GToTree PR; their storage stays as currently configured until ported.

## Validation

```bash
cd accounts
npm ci
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
cd ../frontend
npm ci
npm run build
node --test tests/*.test.mjs
```

Backend tests use signed local RSA JWTs and fake services, with no AWS writes.
CloudFormation schema checks use `cfn-lint accounts/stack.yaml`. Full deployment,
Cognito email delivery, browser sign-in and private-bucket behavior must still
be verified in the real AWS account during the rollout above.

## Add the other MAB apps

For TaxonSleuth, FeGenie, breseq and BASIL, use [MAB_ACCOUNTS_ALL_APPS.md](MAB_ACCOUNTS_ALL_APPS.md). It extends the existing stack and retains the pool and profiles.

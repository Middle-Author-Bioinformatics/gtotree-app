#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v aws >/dev/null || { echo 'Run this in AWS CloudShell.' >&2; exit 1; }
parameters_dir=$(mktemp -d)
trap 'rm -rf "$parameters_dir"' EXIT
# Read the deployed stack, rather than reconfiguring clients or reusing stale local settings.
aws cloudformation describe-stacks --region us-east-2 --stack-name mab-accounts --query 'Stacks[0].Parameters' --output json > "$parameters_dir/current.json"
python3 - "$parameters_dir/current.json" "$parameters_dir/parameters.json" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    parameters = {item['ParameterKey']: item['ParameterValue'] for item in json.load(source)
                  if item['ParameterKey'] not in ('ArtifactBucket', 'ArtifactKey')}
if not parameters.get('ClientIds') or not parameters.get('AllowedOrigins'):
    raise SystemExit('Existing MAB account stack settings are missing; no deployment was started.')
with open(sys.argv[2], 'w') as output:
    json.dump(parameters, output)
PY
MAB_DEPLOY_PARAMETERS_FILE="$parameters_dir/parameters.json" bash deploy.sh

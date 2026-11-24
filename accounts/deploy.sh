#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION=us-east-2
export AWS_DEFAULT_REGION=us-east-2
for program in aws node npm python3 zip; do command -v "$program" >/dev/null || { echo "Missing $program; use AWS CloudShell." >&2; exit 1; }; done
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
account_id=$(aws sts get-caller-identity --query Account --output text)
artifact_bucket="mab-accounts-assets-${account_id}-us-east-2"
if ! aws s3api head-bucket --bucket "$artifact_bucket" 2>/dev/null; then
  aws s3api create-bucket --bucket "$artifact_bucket" --create-bucket-configuration LocationConstraint=us-east-2 >/dev/null
fi
aws s3api put-public-access-block --bucket "$artifact_bucket" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
npm ci --omit=dev
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
zip -qr "$build_dir/accounts.zip" ./*.mjs node_modules
artifact_key="accounts/$(sha256sum "$build_dir/accounts.zip" | cut -d' ' -f1).zip"
aws s3 cp "$build_dir/accounts.zip" "s3://${artifact_bucket}/${artifact_key}" --only-show-errors
aws cloudformation deploy --stack-name mab-accounts --template-file stack.yaml --capabilities CAPABILITY_IAM --parameter-overrides "ArtifactBucket=$artifact_bucket" "ArtifactKey=$artifact_key" --no-fail-on-empty-changeset
if ! aws cognito-idp get-group --user-pool-id us-east-2_VzCBot5S3 --group-name mab-admin >/dev/null 2>&1; then
  aws cognito-idp create-group --user-pool-id us-east-2_VzCBot5S3 --group-name mab-admin --description 'MAB account administrators' >/dev/null
fi
api_url=$(aws cloudformation describe-stacks --stack-name mab-accounts --query "Stacks[0].Outputs[?OutputKey=='AccountApiUrl'].OutputValue" --output text)
printf '\nSet these Amplify environment variables and redeploy main:\nVITE_MAB_AUTH_ENABLED=true\nVITE_MAB_API_BASE=%s\n' "${api_url%/}"
printf '\nExisting input/results buckets and the old upload endpoint have NOT been changed.\n'

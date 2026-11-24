#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 configure-apps.py --apply
bash deploy.sh
python3 configure-apps.py --enable-frontends --apply
printf '\nWait for all five Amplify deployments, then test sign-in, a new submission and a shared result code in each app.\n'
printf 'After those tests, run: python3 private-apps.py --apply\n'

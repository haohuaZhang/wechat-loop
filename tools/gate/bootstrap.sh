#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p tools/gate
touch tools/gate/.bootstrap_stamp
echo "bootstrap OK: $(date)  root=$ROOT"

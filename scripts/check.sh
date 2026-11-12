#!/usr/bin/env bash
# POSIX convenience wrapper. The gate itself is scripts/check.ts so Windows can
# run exactly the same steps with `bun run check`.
set -euo pipefail

cd "$(dirname "$0")/.."
exec bun run scripts/check.ts

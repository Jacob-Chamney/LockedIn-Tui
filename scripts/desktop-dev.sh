#!/usr/bin/env bash
# Run the Flutter shell. CoreStore spawns the Bun sidecar itself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/desktop-env.sh"

cd "$ROOT/desktop"
flutter run -d linux "$@"

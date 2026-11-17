#!/usr/bin/env bash
# The desktop gate: formatting, analyze, widget tests, and the core contract.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/desktop-env.sh"

cd "$ROOT/desktop"
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test

cd "$ROOT"
bun run typecheck
bun test tests/unit/server-protocol.test.ts tests/unit/server-chat.test.ts tests/unit/server-settings.test.ts tests/integration/server-data.test.ts

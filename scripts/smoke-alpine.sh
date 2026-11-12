#!/usr/bin/env bash
# Execute a musl artifact on Alpine, including first paint and workspace creation.
# Alpine's minimal image does not ship libstdc++, which the musl build needs.
set -euo pipefail

artifact="${1:?usage: smoke-alpine.sh <artifact> <version>}"
version="${2:?usage: smoke-alpine.sh <artifact> <version>}"
file="$(basename "$artifact")"
dir="$(cd "$(dirname "$artifact")" && pwd)"

if [ ! -f "$artifact" ]; then
  echo "smoke-alpine: missing $artifact" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "smoke-alpine: docker is required" >&2
  exit 1
fi

docker run --rm -v "$dir:/rel:ro" alpine:3.20 sh -c "
  set -e
  apk add --no-cache libstdc++ util-linux >/dev/null 2>&1
  cp /rel/$file /tmp/lockedin
  chmod +x /tmp/lockedin
  /tmp/lockedin --version | grep -qx 'lockedin $version'
  mkdir -p /tmp/run
  timeout 15 script -qfec \"env HOME=/tmp/run TERM=xterm-256color /tmp/lockedin --workspace /tmp/run/ws\" /dev/null > /tmp/out 2>&1 || true
  grep -aq LOCKEDIN /tmp/out
  test -f /tmp/run/ws/workspace.json
  echo \"smoke-alpine: $file --version, first paint and workspace ok\"
"

#!/usr/bin/env bash
# Package the Linux desktop release as a distributable tarball.
#
# The bundle is produced by scripts/desktop-build.sh (Flutter shell + compiled
# Bun core sidecar). This script only stages and verifies the artifact; it does
# not build Flutter itself unless asked, so CI can reuse its release build.
#
#   scripts/desktop-package.sh            # build, then package
#   scripts/desktop-package.sh --no-build # reuse desktop/build/.../bundle
#
# Output: dist/lockedin-desktop-linux-x64.tar.gz
# The archive root is the bundle directory's contents, so a recipient runs
# `tar -xzf ... && ./lockedin_desktop`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/desktop/build/linux/x64/release/bundle"
DIST="$ROOT/dist"
ARTIFACT="$DIST/lockedin-desktop-linux-x64.tar.gz"
LICENSE_SRC="$ROOT/LICENSE"
NOTICE_SRC="$ROOT/NOTICE"
NOTICES_SRC="$ROOT/THIRD-PARTY-NOTICES.md"
BUILD=1

usage() {
  echo "usage: $0 [--no-build]" >&2
}

for arg in "$@"; do
  case "$arg" in
    --no-build)
      BUILD=0
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

if [ "$BUILD" -eq 1 ]; then
  "$ROOT/scripts/desktop-build.sh" linux
fi

if [ ! -d "$BUNDLE" ]; then
  echo "missing bundle: $BUNDLE" >&2
  echo "run scripts/desktop-build.sh linux first" >&2
  exit 1
fi
if [ ! -f "$LICENSE_SRC" ]; then
  echo "missing application licence: $LICENSE_SRC" >&2
  exit 1
fi

# The binary distribution carries the app licence. Copying into the bundle keeps
# the tarball self-describing and is idempotent across re-runs.
cp -f "$LICENSE_SRC" "$BUNDLE/LICENSE"
cp -f "$NOTICE_SRC" "$BUNDLE/NOTICE"
cp -f "$NOTICES_SRC" "$BUNDLE/THIRD-PARTY-NOTICES.md"

REQUIRED=(
  lockedin_desktop
  lockedin-core
  lib/libflutter_linux_gtk.so
  data/flutter_assets/NOTICES.Z
  LICENSE
  NOTICE
  THIRD-PARTY-NOTICES.md
  node_modules/@napi-rs/keyring/index.js
)

for entry in "${REQUIRED[@]}"; do
  if [ ! -e "$BUNDLE/$entry" ]; then
    echo "missing bundle entry: $entry" >&2
    exit 1
  fi
done

# The keyring addon's JS entry alone is useless: the native binary is what
# `bun build --compile` cannot embed, so a bundle without one ships a core that
# silently falls back to `secret-tool`.
if ! find "$BUNDLE/node_modules/@napi-rs" -name '*.node' -type f 2>/dev/null |
  grep -q .; then
  echo "missing native keyring addon: no *.node under bundle/node_modules/@napi-rs" >&2
  echo "run scripts/desktop-build.sh linux (without LOCKEDIN_SKIP_KEYRING) first" >&2
  exit 1
fi

if [ ! -x "$BUNDLE/lockedin-core" ]; then
  echo "bundled core is not executable: $BUNDLE/lockedin-core" >&2
  exit 1
fi

mkdir -p "$DIST"
tar -czf "$ARTIFACT" -C "$BUNDLE" .

# Verify the archive itself, not just the staged directory: a wrong -C or an
# excluded path must fail here rather than at the user's machine.
LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
tar -tzf "$ARTIFACT" >"$LIST"
for entry in "${REQUIRED[@]}"; do
  if ! grep -qxF "./$entry" "$LIST"; then
    echo "missing archive entry: $entry" >&2
    exit 1
  fi
done
if ! grep -qE '\.node$' "$LIST"; then
  echo "missing archive entry: a native keyring *.node addon" >&2
  exit 1
fi

BYTES="$(wc -c <"$ARTIFACT" | tr -d '[:space:]')"
HUMAN="$(du -h "$ARTIFACT" | cut -f1)"
echo "artifact: $ARTIFACT"
echo "size: $HUMAN ($BYTES bytes)"

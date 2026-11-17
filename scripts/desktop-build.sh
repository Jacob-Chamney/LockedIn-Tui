#!/usr/bin/env bash
# Build the desktop shell and bundle the core sidecar next to it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/desktop-env.sh"

TARGET="${1:-linux}"
cd "$ROOT/desktop"

case "$TARGET" in
  linux)
    flutter build linux --release
    BUNDLE="$ROOT/desktop/build/linux/x64/release/bundle"
    BUN_TARGET="bun-linux-x64"
    NAME="lockedin-core"
    ;;
  windows)
    flutter build windows --release
    BUNDLE="$ROOT/desktop/build/windows/x64/runner/Release"
    BUN_TARGET="bun-windows-x64"
    NAME="lockedin-core.exe"
    ;;
  *)
    echo "usage: $0 [linux|windows]" >&2
    exit 2
    ;;
esac

# The shell resolves this file from its own directory; without it a packaged
# app would fall back to `bun run` and fail on a machine without Bun.
#
# `LOCKEDIN_RELEASE=1` is what makes the sidecar a release build: achievements
# stay locked until their counters are met (`UNLOCK_ALL_ACHIEVEMENTS =
# !RELEASE_BUILD` in src/domain/achievements.ts) and `--version` reports the
# package version. Without the define a packaged app would unlock the whole
# catalogue on first launch.
VERSION="${LOCKEDIN_APP_VERSION:-$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$ROOT/package.json")}"
cd "$ROOT"
bun build --compile --target="$BUN_TARGET" \
  --define 'process.env.LOCKEDIN_RELEASE="1"' \
  --define "process.env.LOCKEDIN_APP_VERSION=\"$VERSION\"" \
  src/server/main.ts --outfile "$BUNDLE/$NAME"
echo "bundled core: $BUNDLE/$NAME (release build, version $VERSION)"

# `bun build --compile` cannot embed a native `.node` addon. The keychain
# adapter therefore loads `@napi-rs/keyring` from the bundle and the shell points
# at it with LOCKEDIN_KEYRING_ADDON (see desktop/lib/bridge/core_client.dart).
# Copy the JS entry plus the platform binary beside the sidecar; without them a
# packaged app falls back to the `secret-tool` shim.
KEYRING_ADDON="$ROOT/node_modules/@napi-rs/keyring"
BUNDLE_NODE_MODULES="$BUNDLE/node_modules/@napi-rs"

if [ "${LOCKEDIN_SKIP_KEYRING:-0}" = "1" ]; then
  echo "skipping the keyring addon (LOCKEDIN_SKIP_KEYRING=1)"
else
  if [ ! -f "$KEYRING_ADDON/index.js" ]; then
    echo "missing keyring addon: $KEYRING_ADDON/index.js" >&2
    echo "run bun install, or set LOCKEDIN_SKIP_KEYRING=1 to build without the OS keychain" >&2
    exit 1
  fi

  mkdir -p "$BUNDLE_NODE_MODULES"
  rm -rf "$BUNDLE_NODE_MODULES/keyring"
  cp -R "$KEYRING_ADDON" "$BUNDLE_NODE_MODULES/keyring"

  # One platform package per target. The addon's own loader requires the
  # package by name from this directory, so the folder name must be exact.
  case "$TARGET" in
    linux)
      PLATFORM_PACKAGES=(keyring-linux-x64-gnu)
      # A musl artifact also needs the musl build; it is absent from a glibc
      # install, so it is copied only when present.
      if [ -d "$ROOT/node_modules/@napi-rs/keyring-linux-x64-musl" ]; then
        PLATFORM_PACKAGES+=(keyring-linux-x64-musl)
      fi
      ;;
    windows)
      PLATFORM_PACKAGES=(keyring-win32-x64-msvc)
      ;;
  esac

  for package in "${PLATFORM_PACKAGES[@]}"; do
    source_dir="$ROOT/node_modules/@napi-rs/$package"
    if [ ! -d "$source_dir" ]; then
      echo "missing keyring platform package: $source_dir" >&2
      echo "run bun install for this platform, or set LOCKEDIN_SKIP_KEYRING=1 to build without the OS keychain" >&2
      exit 1
    fi
    rm -rf "$BUNDLE_NODE_MODULES/$package"
    cp -R "$source_dir" "$BUNDLE_NODE_MODULES/$package"

    # The addon's loader looks for `./keyring.<platform>.node` beside its own
    # `index.js` first, and only then for the package by name. Inside a compiled
    # Bun binary a relative `require` from the external entry works while a bare
    # package specifier does not, so the binary is copied flat as well as kept
    # in its package. Musl and glibc both land here; the loader picks one.
    for binding in "$source_dir"/*.node; do
      [ -e "$binding" ] || continue
      cp -f "$binding" "$BUNDLE_NODE_MODULES/keyring/"
    done
  done

  if ! find "$BUNDLE_NODE_MODULES" -name '*.node' -type f | grep -q .; then
    echo "missing native keyring addon: no *.node under $BUNDLE_NODE_MODULES" >&2
    exit 1
  fi

  echo "bundled keyring addon: $BUNDLE_NODE_MODULES"
fi

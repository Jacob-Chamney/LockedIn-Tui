#!/bin/sh
# LockedIn-Tui installer.
#
#   curl -fsSL https://github.com/Jacob-Chamney/LockedIn-Tui/releases/latest/download/install.sh | sh
#
# Detects the OS/architecture/libc, downloads the matching release artifact,
# verifies it against the release's SHA256SUMS, and installs it to
# ~/.local/bin/lockedin (override with LOCKEDIN_INSTALL_DIR).
#
# Pin a version with LOCKEDIN_VERSION=2026.11.12. The script never uses sudo and
# never edits a shell profile; it prints the PATH line when one is needed.
set -eu

REPO="Jacob-Chamney/LockedIn-Tui"
VERSION="${LOCKEDIN_VERSION:-}"
INSTALL_DIR="${LOCKEDIN_INSTALL_DIR:-$HOME/.local/bin}"

fail() {
  printf 'lockedin-install: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v awk >/dev/null 2>&1 || fail "awk is required"
command -v sed >/dev/null 2>&1 || fail "sed is required"
[ -n "${HOME:-}" ] || fail "HOME is not set"

case "$(uname -s)" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

libc=""
if [ "$os" = "linux" ]; then
  if [ -f /etc/alpine-release ] || ls /lib/ld-musl-* >/dev/null 2>&1; then
    libc="-musl"
  fi
fi

if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' |
    head -n 1)
  [ -n "$VERSION" ] || fail "could not find the latest release"
fi

ARTIFACT="lockedin-$VERSION-bun-$os-$arch$libc"
BASE="https://github.com/$REPO/releases/download/v$VERSION"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

printf 'Downloading %s ...\n' "$ARTIFACT"
curl -fsSL -o "$TMPDIR/$ARTIFACT" "$BASE/$ARTIFACT"
curl -fsSL -o "$TMPDIR/SHA256SUMS" "$BASE/SHA256SUMS"

awk -v name="$ARTIFACT" '{ file=$2; sub(/^\*/, "", file); if (file == name) print }' \
  "$TMPDIR/SHA256SUMS" > "$TMPDIR/one"
[ -s "$TMPDIR/one" ] || fail "the release has no checksum for $ARTIFACT"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$TMPDIR" && sha256sum -c one >/dev/null) || fail "checksum verification failed"
elif command -v shasum >/dev/null 2>&1; then
  (cd "$TMPDIR" && shasum -a 256 -c one >/dev/null) || fail "checksum verification failed"
else
  fail "sha256sum or shasum is required to verify the download"
fi

mkdir -p "$INSTALL_DIR" || fail "could not create $INSTALL_DIR"
cp "$TMPDIR/$ARTIFACT" "$INSTALL_DIR/lockedin" || fail "could not write $INSTALL_DIR/lockedin"
chmod 0755 "$INSTALL_DIR/lockedin"
printf 'Installed %s\n' "$INSTALL_DIR/lockedin"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    printf '\nAdd this to your shell profile:\n'
    printf '  export PATH="%s:$PATH"\n' "$INSTALL_DIR"
    ;;
esac

if [ "$os" = "linux" ] && [ "$libc" = "-musl" ]; then
  printf '\nAlpine needs the C++ runtime:\n  apk add libstdc++\n'
fi

(cd "$INSTALL_DIR" && ./lockedin --version)

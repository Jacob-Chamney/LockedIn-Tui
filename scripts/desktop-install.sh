#!/usr/bin/env bash
# Install the packaged Linux build for the current user.
#
#   scripts/desktop-install.sh                       # install the local release bundle
#   scripts/desktop-install.sh --bundle ~/lockedin-test
#   scripts/desktop-install.sh --prefix ~/.local     # the default
#   scripts/desktop-install.sh --uninstall
#
# What it writes, and nothing else:
#   <prefix>/lib/lockedin-desktop/          the bundle (shell, core, addon, licences)
#   <prefix>/bin/lockedin-desktop           a symlink to the shell in that folder
#   <prefix>/share/applications/lockedin.desktop   a launcher entry
#
# It never uses sudo, never edits a shell profile, and never touches the
# workspace (`~/LockedIn`) or the app-data folder: those are the user's, and
# uninstalling leaves them exactly as they are.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/desktop/build/linux/x64/release/bundle"
PREFIX="$HOME/.local"
UNINSTALL=0

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

# Both `--prefix DIR` and `--prefix=DIR` work: the separate form is what a path
# with a space needs.
require_value() {
  if [ -z "${2:-}" ]; then
    echo "error: $1 needs a value" >&2
    exit 2
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --bundle=*) BUNDLE="${1#*=}" ;;
    --bundle)
      require_value "$1" "${2:-}"
      BUNDLE="$2"
      shift
      ;;
    --prefix=*) PREFIX="${1#*=}" ;;
    --prefix)
      require_value "$1" "${2:-}"
      PREFIX="$2"
      shift
      ;;
    --uninstall) UNINSTALL=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

LIB="$PREFIX/lib/lockedin-desktop"
BIN="$PREFIX/bin/lockedin-desktop"
DESKTOP="$PREFIX/share/applications/lockedin.desktop"

if [ "$UNINSTALL" -eq 1 ]; then
  removed=0
  for path in "$BIN" "$DESKTOP"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      rm -f "$path"
      echo "removed $path"
      removed=1
    fi
  done
  if [ -d "$LIB" ]; then
    rm -rf "$LIB"
    echo "removed $LIB"
    removed=1
  fi
  if [ "$removed" -eq 0 ]; then
    echo "nothing installed under $PREFIX"
  else
    echo "uninstalled; your workspace and app data were not touched"
  fi
  exit 0
fi

if [ ! -x "$BUNDLE/lockedin_desktop" ]; then
  echo "error: no packaged build at $BUNDLE" >&2
  echo "run scripts/desktop-build.sh linux first, or pass --bundle=DIR" >&2
  exit 1
fi
if [ ! -x "$BUNDLE/lockedin-core" ]; then
  echo "error: $BUNDLE has no lockedin-core sidecar" >&2
  exit 1
fi

# A root-owned prefix would need sudo to repair later; refuse rather than half
# install, and name the fix.
if ! mkdir -p "$PREFIX/bin" "$PREFIX/share/applications" 2>/dev/null; then
  echo "error: $PREFIX is not writable" >&2
  echo "choose another prefix (--prefix ~/.local) or fix its permissions" >&2
  exit 1
fi

# Replace the previous install atomically enough: stage beside the target, then
# swap. A running app keeps its own files open, so this is safe while it runs.
STAGE="$PREFIX/lib/.lockedin-desktop-new"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -a "$BUNDLE/." "$STAGE/"
chmod +x "$STAGE/lockedin_desktop" "$STAGE/lockedin-core"
rm -rf "$LIB"
mv "$STAGE" "$LIB"

ln -sfn "$LIB/lockedin_desktop" "$BIN"

# Exec is absolute because a launcher does not inherit the shell's PATH; the
# symlinked shell resolves its own bundle directory for the sidecar.
cat >"$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=LockedIn
Comment=Learn from your sources, and work on your projects
Exec=$BIN
Icon=utilities-terminal
Terminal=false
Categories=Education;Office;
StartupWMClass=lockedin_desktop
EOF
chmod 644 "$DESKTOP"

echo "installed $LIB"
echo "command: $BIN"
echo "launcher: $DESKTOP"
echo "workspace and app data were not touched"

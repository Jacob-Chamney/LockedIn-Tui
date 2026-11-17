#!/usr/bin/env bash
# Capture the desktop screenshot set from the release bundle.
#
# Everything runs against throwaway state: a caller-supplied workspace, a
# caller-supplied data directory and a temporary HOME. The OS keychain is
# reached through a *private* D-Bus session with a fresh, empty gnome-keyring, so
# a screenshot can never show a real linked provider. Nothing is written inside
# the workspace or the repository, only PNGs into the output directory.
#
#   scripts/desktop-screenshots.sh \
#     --workspace /tmp/lockedin-shots/workspace \
#     --data      /tmp/lockedin-shots/data
#
# The workspace must be pre-seeded with synthetic data (see
# desktop/docs/screenshots/README.md). This script never invents or edits data.
#
# Options:
#   --workspace DIR   isolated workspace root (required; must exist)
#   --data DIR        isolated app-data dir (required; usage.json/stats.json)
#   --out DIR         png destination (default desktop/docs/screenshots)
#   --display :N      X display (default :99; the script starts Xvfb on it)
#   --no-build        reuse desktop/build/.../bundle instead of rebuilding
#   --keep            keep the temporary HOME and the running app for debugging
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/desktop/build/linux/x64/release/bundle"
OUT="$ROOT/desktop/docs/screenshots"
WORKSPACE=""
DATA=""
DISPLAY_NUM=":99"
BUILD=1
KEEP=0

WIDE="1400x900"
NARROW="800x600"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --data) DATA="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --display) DISPLAY_NUM="${2:-}"; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --keep) KEEP=1; shift ;;
    -h | --help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

if [ -z "$WORKSPACE" ] || [ -z "$DATA" ]; then
  echo "error: --workspace and --data are required (never point them at real user state)" >&2
  exit 2
fi
if [ ! -d "$WORKSPACE" ]; then
  echo "error: workspace does not exist: $WORKSPACE" >&2
  exit 1
fi

for tool in Xvfb xdotool import identify; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is required (install ImageMagick and xdotool)" >&2
    exit 1
  fi
done

if [ "$BUILD" -eq 1 ]; then
  "$ROOT/scripts/desktop-build.sh" linux
fi
if [ ! -x "$BUNDLE/lockedin_desktop" ]; then
  echo "error: missing release bundle: $BUNDLE/lockedin_desktop" >&2
  echo "run scripts/desktop-build.sh linux first" >&2
  exit 1
fi

mkdir -p "$OUT"
TMP_HOME="$(mktemp -d)"
XVFB_PID=""
APP_PID=""
WID=""

cleanup() {
  if [ -n "$APP_PID" ]; then
    # The app runs in its own process group (setsid) with dbus-run-session and
    # gnome-keyring as children; kill the group so no keyring survives a run.
    kill -- "-$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$XVFB_PID" ]; then
    kill "$XVFB_PID" 2>/dev/null || true
  fi
  if [ "$KEEP" -eq 0 ]; then
    rm -rf "$TMP_HOME"
  else
    echo "kept HOME: $TMP_HOME"
  fi
}
trap cleanup EXIT

start_display() {
  local geometry="$1"
  if [ -n "$XVFB_PID" ]; then
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
    XVFB_PID=""
  fi
  # Wait for the old server's socket to disappear, so the next app cannot
  # connect to a server that is shutting down.
  local _guard
  for _guard in $(seq 1 50); do
    if ! DISPLAY="$DISPLAY_NUM" xdotool getdisplaygeometry >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done
  Xvfb "$DISPLAY_NUM" -screen 0 "${geometry}x24" >"$TMP_HOME/xvfb.log" 2>&1 &
  XVFB_PID=$!
  # Xvfb needs a moment before it accepts a connection.
  for _guard in $(seq 1 50); do
    if DISPLAY="$DISPLAY_NUM" xdotool getdisplaygeometry >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  echo "error: Xvfb did not come up on $DISPLAY_NUM" >&2
  exit 1
}

window_alive() {
  [ -n "${1:-}" ] && DISPLAY="$DISPLAY_NUM" xdotool getwindowgeometry "$1" >/dev/null 2>&1
}

wait_for_window() {
  local deadline=$((SECONDS + 45))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local candidate
    candidate="$(DISPLAY="$DISPLAY_NUM" xdotool search --onlyvisible --name '^lockedin_desktop$' 2>/dev/null | head -1 || true)"
    # A window can be mapped and replaced while the engine settles; keep polling
    # until the same id is still alive a moment later.
    if window_alive "$candidate"; then
      sleep 0.3
      if window_alive "$candidate"; then
        WID="$candidate"
        return 0
      fi
    fi
    sleep 0.2
  done
  echo "error: the app window never appeared; see $TMP_HOME/app.err" >&2
  exit 1
}

resize_window() {
  local width="$1" height="$2"
  local attempt
  for attempt in $(seq 1 25); do
    if window_alive "$WID" &&
      DISPLAY="$DISPLAY_NUM" xdotool windowsize "$WID" "$width" "$height" 2>/dev/null; then
      return 0
    fi
    sleep 0.2
    wait_for_window
  done
  echo "error: could not resize the app window to ${width}x${height}" >&2
  exit 1
}

launch_app() {
  local geometry="$1"
  start_display "$geometry"
  : >"$TMP_HOME/app.err"
  mkdir -p "$TMP_HOME/home"
  (
    export HOME="$TMP_HOME/home"
    export XDG_DATA_HOME="$TMP_HOME/home/.local/share"
    export XDG_CONFIG_HOME="$TMP_HOME/home/.config"
    export LOCKEDIN_WORKSPACE="$WORKSPACE"
    export LOCKEDIN_DATA_DIR="$DATA"
    export DISPLAY="$DISPLAY_NUM"
    # Never let GTK pick the host's Wayland/Hyprland session: the screenshots
    # must come from the virtual X display, not the developer's desktop.
    unset WAYLAND_DISPLAY XDG_SESSION_TYPE
    export GDK_BACKEND=x11
    # A private bus plus a *fresh* keyring keeps the real keychain invisible.
    exec setsid dbus-run-session -- bash -c '
      printf "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1 || true
      exec "$1"
    ' _ "$BUNDLE/lockedin_desktop"
  ) >"$TMP_HOME/app.log" 2>"$TMP_HOME/app.err" &
  APP_PID=$!
  wait_for_window
  resize_window "${geometry%x*}" "${geometry#*x}"
  DISPLAY="$DISPLAY_NUM" xdotool windowfocus "$WID"
  # First frame is already painted; give the core one round of data requests.
  sleep 4
}

stop_app() {
  if [ -n "$APP_PID" ]; then
    kill -- "-$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
    APP_PID=""
  fi
  WID=""
}

key() {
  DISPLAY="$DISPLAY_NUM" xdotool key --clearmodifiers "$@"
  sleep 1.6
}

# $1 = file stem. Verified immediately so a missing or blank capture fails here.
shot() {
  local name="$1"
  local path="$OUT/$name.png"
  DISPLAY="$DISPLAY_NUM" import -window "$WID" "$path"
  identify "$path"
}

echo "== wide set ($WIDE)"
launch_app "$WIDE"

shot chat
key alt+2
shot sessions
key Return
shot session-detail
key c
shot session-chat
key alt+3
shot skills
key Return
shot skill-detail
key alt+5
shot stats
# `a` opens the achievement inventory over Stats.
key a
shot achievements
key Escape
key alt+6
shot work
key Return
shot work-detail
# `l` opens the activity log over the project (empty on a fresh seed).
key l
shot activity
key Escape
key alt+7
shot review
key alt+8
shot archive-empty
key alt+9
shot knowledge
# The first tree row is a school note; Enter opens it in the reader.
key Return
shot knowledge-reader
key Escape
key alt+0
shot settings

# The connect-model dialog is the only capture that needs a pointer: the
# settings list owns the arrow keys, so the script clicks the button. The window
# is pinned to $WIDE at +0+0 (no window manager), so the point is stable.
echo "== connect dialog"
DISPLAY="$DISPLAY_NUM" xdotool mousemove 445 595 click 1
sleep 2.5
shot connect-dialog
key Escape

stop_app

echo "== narrow set ($NARROW)"
launch_app "$NARROW"
shot chat-narrow
stop_app

if [ -n "$XVFB_PID" ]; then
  kill "$XVFB_PID" 2>/dev/null || true
  wait "$XVFB_PID" 2>/dev/null || true
  XVFB_PID=""
fi

echo
echo "captured into: $OUT"
ls -1 "$OUT"/*.png

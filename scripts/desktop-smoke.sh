#!/usr/bin/env bash
# Smoke-test the packaged Linux bundle: launch it against throwaway state on a
# virtual display, prove it paints, then prove the core booted by checking the
# workspace it created.
#
#   scripts/desktop-smoke.sh                       # latest local release bundle
#   scripts/desktop-smoke.sh --bundle /tmp/app     # an extracted tarball
#   scripts/desktop-smoke.sh --keep                # leave the frame and logs
#
# What it checks, in order:
#   1. the shell window is mapped (a build that cannot start fails here);
#   2. the first frame has real content (a blank PNG is not a pass);
#   3. the sidecar booted and wrote `workspace.json` into an empty folder;
#   4. the sidecar process is alive (the shell and core really connected).
#
# It never touches the caller's workspace, HOME, keychain or display: state lives
# under --out, and the keychain is a private D-Bus session with a fresh ring.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/desktop/build/linux/x64/release/bundle"
OUT="${TMPDIR:-/tmp}/lockedin-smoke"
DISPLAY_NUM=""
SIZE="1280x800"
KEEP=0

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --bundle=*) BUNDLE="${arg#*=}" ;;
    --out=*) OUT="${arg#*=}" ;;
    --display=*) DISPLAY_NUM="${arg#*=}" ;;
    --size=*) SIZE="${arg#*=}" ;;
    --keep) KEEP=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ ! -x "$BUNDLE/lockedin_desktop" ] || [ ! -x "$BUNDLE/lockedin-core" ]; then
  echo "error: no packaged build at $BUNDLE" >&2
  echo "run scripts/desktop-build.sh linux first (or pass --bundle=DIR)" >&2
  exit 1
fi

for tool in Xvfb xdotool import identify dbus-run-session; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is required for the headless smoke test" >&2
    exit 1
  fi
done

WIDTH="${SIZE%x*}"
HEIGHT="${SIZE#*x}"
WORKSPACE="$OUT/workspace"
DATA="$OUT/data"
HOME_DIR="$OUT/home"
XVFB_PID=""
APP_PID=""
WID=""

cleanup() {
  local status=$?
  if [ "$KEEP" -eq 0 ]; then
    if [ -n "$APP_PID" ]; then
      kill -- "-$APP_PID" 2>/dev/null || true
      wait "$APP_PID" 2>/dev/null || true
    fi
    if [ -n "$XVFB_PID" ]; then
      kill "$XVFB_PID" 2>/dev/null || true
      wait "$XVFB_PID" 2>/dev/null || true
    fi
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# Fresh state every run: an empty workspace is the interesting first-run case,
# and `workspace.json` appearing is what proves the core booted.
rm -rf "$OUT"
mkdir -p "$WORKSPACE" "$DATA" "$HOME_DIR"

pick_display() {
  local n
  for n in 99 98 97 96 95; do
    if ! DISPLAY=":$n" xdotool getdisplaygeometry >/dev/null 2>&1; then
      DISPLAY_NUM=":$n"
      return 0
    fi
  done
  echo "error: no free virtual display in :95-:99 (pass --display=:N)" >&2
  exit 1
}

if [ -z "$DISPLAY_NUM" ]; then
  pick_display
fi

Xvfb "$DISPLAY_NUM" -screen 0 "${WIDTH}x${HEIGHT}x24" >"$OUT/xvfb.log" 2>&1 &
XVFB_PID=$!
for _ in $(seq 1 50); do
  if DISPLAY="$DISPLAY_NUM" xdotool getdisplaygeometry >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! DISPLAY="$DISPLAY_NUM" xdotool getdisplaygeometry >/dev/null 2>&1; then
  echo "error: Xvfb did not start on $DISPLAY_NUM" >&2
  exit 1
fi

(
  export HOME="$HOME_DIR"
  export XDG_DATA_HOME="$HOME_DIR/.local/share"
  export XDG_CONFIG_HOME="$HOME_DIR/.config"
  export LOCKEDIN_WORKSPACE="$WORKSPACE"
  export LOCKEDIN_DATA_DIR="$DATA"
  export DISPLAY="$DISPLAY_NUM"
  # The host session (Wayland/Hyprland) must not capture the window.
  unset WAYLAND_DISPLAY XDG_SESSION_TYPE
  export GDK_BACKEND=x11
  exec setsid dbus-run-session -- bash -c '
    printf "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1 || true
    exec "$1"
  ' _ "$BUNDLE/lockedin_desktop"
) >"$OUT/app.log" 2>"$OUT/app.err" &
APP_PID=$!

deadline=$((SECONDS + 60))
while [ "$SECONDS" -lt "$deadline" ]; do
  WID="$(DISPLAY="$DISPLAY_NUM" xdotool search --onlyvisible --name '^lockedin_desktop$' 2>/dev/null | head -1 || true)"
  if [ -n "$WID" ]; then
    sleep 0.5
    break
  fi
  sleep 0.2
done
if [ -z "$WID" ]; then
  echo "error: the app window never appeared" >&2
  tail -10 "$OUT/app.err" >&2 || true
  exit 1
fi
echo "window: $WID on $DISPLAY_NUM (${WIDTH}x${HEIGHT})"

DISPLAY="$DISPLAY_NUM" xdotool windowsize "$WID" "$WIDTH" "$HEIGHT" 2>/dev/null || true
DISPLAY="$DISPLAY_NUM" xdotool windowfocus "$WID" 2>/dev/null || true

# The core answers its first data request before the chat surface is settled.
deadline=$((SECONDS + 60))
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ -f "$WORKSPACE/workspace.json" ]; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "error: the app exited before booting the core" >&2
    tail -10 "$OUT/app.err" >&2 || true
    exit 1
  fi
  sleep 0.2
done
if [ ! -f "$WORKSPACE/workspace.json" ]; then
  echo "error: the core never created workspace.json in an empty folder" >&2
  tail -10 "$OUT/app.err" >&2 || true
  exit 1
fi
echo "core: booted, workspace.json written"

sleep 3
FRAME="$OUT/smoke.png"
DISPLAY="$DISPLAY_NUM" import -window "$WID" "$FRAME"
COLORS="$(identify -format '%k' "$FRAME")"
PIXELS="$(identify -format '%wx%h' "$FRAME")"
if [ "$COLORS" -lt 8 ]; then
  echo "error: the first frame is blank ($COLORS colours in $PIXELS)" >&2
  exit 1
fi
echo "frame: $FRAME $PIXELS, $COLORS colours"

if ! pgrep -f "$BUNDLE/lockedin-core" >/dev/null 2>&1; then
  echo "error: the sidecar is not running; the shell and core did not connect" >&2
  exit 1
fi
echo "sidecar: running"

echo "ok: bundle launches, paints and boots"
if [ "$KEEP" -eq 1 ]; then
  echo "kept: $OUT (app.log, app.err, smoke.png)"
  APP_PID=""
  XVFB_PID=""
fi

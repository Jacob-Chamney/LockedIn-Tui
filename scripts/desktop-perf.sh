#!/usr/bin/env bash
# Measure the packaged Linux bundle's cold first paint and compare it with the
# documented desktop budget.
#
#   scripts/desktop-perf.sh                  # 3 runs, budget from the fixture
#   scripts/desktop-perf.sh --runs=5         # more samples
#   scripts/desktop-perf.sh --max-ms=2500    # what would 2.5 s mean? (still measures)
#   scripts/desktop-perf.sh --host-factor=1.9 # a host slower than the reference
#   scripts/desktop-perf.sh --json           # machine-readable
#
# The measurement is the packaged app under Xvfb on an empty workspace: the
# time from process start to the first captured frame with real content. The
# best of N is reported, because a loaded machine inflates a median and a real
# regression raises every sample.
#
# A missing bundle or a missing tool prints a skip and exits 0: CI without a
# build must not fail the gate. The budget lives in
# `tests/fixtures/desktop-perf-budget.json`; the row in
# `desktop/docs/packaging.md` is the promise and `tests/unit/desktop-perf-budget.test.ts`
# keeps the two equal.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/desktop/build/linux/x64/release/bundle"
OUT="${TMPDIR:-/tmp}/lockedin-perf"
RUNS=3
MAX_MS=""
HOST_FACTOR=1
JSON=0
DISPLAY_NUM=""
SIZE="800x600"
BUDGET_FILE="$ROOT/tests/fixtures/desktop-perf-budget.json"

usage() {
  sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --bundle=*) BUNDLE="${arg#*=}" ;;
    --out=*) OUT="${arg#*=}" ;;
    --runs=*) RUNS="${arg#*=}" ;;
    --max-ms=*) MAX_MS="${arg#*=}" ;;
    --host-factor=*) HOST_FACTOR="${arg#*=}" ;;
    --size=*) SIZE="${arg#*=}" ;;
    --json) JSON=1 ;;
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
  echo "skip: no packaged build at $BUNDLE (run scripts/desktop-build.sh linux first)"
  exit 0
fi
for tool in Xvfb xdotool import identify dbus-run-session; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "skip: $tool is required for the desktop performance check"
    exit 0
  fi
done

if [ -z "$MAX_MS" ]; then
  MAX_MS="$(sed -n 's/.*"maxMs"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$BUDGET_FILE" | head -1)"
  if [ -z "$MAX_MS" ]; then
    echo "error: no maxMs in $BUDGET_FILE" >&2
    exit 1
  fi
fi

if ! [[ "$RUNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: --runs must be a positive whole number" >&2
  exit 2
fi

now_ms() { date +%s%3N; }

WIDTH="${SIZE%x*}"
HEIGHT="${SIZE#*x}"
XVFB_PID=""
SAMPLES=()
CLEAN_PID=""

cleanup() {
  local status=$?
  if [ -n "$XVFB_PID" ]; then
    kill "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

pick_display() {
  local n
  for n in 99 98 97 96 95; do
    if ! DISPLAY=":$n" xdotool getdisplaygeometry >/dev/null 2>&1; then
      DISPLAY_NUM=":$n"
      return 0
    fi
  done
  echo "error: no free virtual display in :95-:99" >&2
  exit 1
}

pick_display
mkdir -p "$OUT"
Xvfb "$DISPLAY_NUM" -screen 0 "${WIDTH}x${HEIGHT}x24" >"$OUT/xvfb.log" 2>&1 &
XVFB_PID=$!
for _ in $(seq 1 50); do
  DISPLAY="$DISPLAY_NUM" xdotool getdisplaygeometry >/dev/null 2>&1 && break
  sleep 0.1
done
if ! DISPLAY="$DISPLAY_NUM" xdotool getdisplaygeometry >/dev/null 2>&1; then
  echo "error: Xvfb did not start on $DISPLAY_NUM" >&2
  exit 1
fi

run_once() {
  local n="$1"
  local workspace="$OUT/run-$n/workspace"
  local data="$OUT/run-$n/data"
  local home="$OUT/run-$n/home"
  pkill -f "$BUNDLE/lockedin_desktop" 2>/dev/null || true
  pkill -f "$BUNDLE/lockedin-core" 2>/dev/null || true
  rm -rf "$OUT/run-$n"
  mkdir -p "$workspace" "$data" "$home"

  (
    export HOME="$home"
    export XDG_DATA_HOME="$home/.local/share"
    export XDG_CONFIG_HOME="$home/.config"
    export LOCKEDIN_WORKSPACE="$workspace"
    export LOCKEDIN_DATA_DIR="$data"
    export DISPLAY="$DISPLAY_NUM"
    unset WAYLAND_DISPLAY XDG_SESSION_TYPE
    export GDK_BACKEND=x11
    exec setsid dbus-run-session -- bash -c '
      printf "" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1 || true
      exec "$1"
    ' _ "$BUNDLE/lockedin_desktop"
  ) >"$OUT/run-$n/app.log" 2>"$OUT/run-$n/app.err" &
  local app_pid=$!

  local start
  start=$(now_ms)
  local wid=""
  local deadline=$((SECONDS + 60))
  while [ "$SECONDS" -lt "$deadline" ]; do
    wid="$(DISPLAY="$DISPLAY_NUM" xdotool search --onlyvisible --name '^lockedin_desktop$' 2>/dev/null | head -1 || true)"
    [ -n "$wid" ] && break
    kill -0 "$app_pid" 2>/dev/null || break
    sleep 0.02
  done
  if [ -z "$wid" ]; then
    echo "error: run $n: the app window never appeared" >&2
    tail -5 "$OUT/run-$n/app.err" >&2 || true
    return 1
  fi

  local paint=""
  local frame="$OUT/run-$n/frame.png"
  deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if DISPLAY="$DISPLAY_NUM" import -window "$wid" "$frame" 2>/dev/null; then
      local colors
      colors="$(identify -format '%k' "$frame" 2>/dev/null || echo 0)"
      if [ "${colors:-0}" -ge 8 ]; then
        paint=$(( $(now_ms) - start ))
        break
      fi
    fi
    kill -0 "$app_pid" 2>/dev/null || break
    sleep 0.05
  done
  if [ -z "$paint" ]; then
    echo "error: run $n: no painted frame within 30 s" >&2
    tail -5 "$OUT/run-$n/app.err" >&2 || true
    kill -- "-$app_pid" 2>/dev/null || true
    return 1
  fi

  # `setsid` gives the app its own session, so the subshell's process group is
  # not the app's: kill the app by its bundle path, then reap the subshell.
  pkill -f "$BUNDLE/lockedin_desktop" 2>/dev/null || true
  pkill -f "$BUNDLE/lockedin-core" 2>/dev/null || true
  for _ in $(seq 1 50); do
    kill -0 "$app_pid" 2>/dev/null || break
    sleep 0.02
  done
  kill -9 "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  echo "$paint"
}

echo "desktop first paint — $SIZE, cold empty workspace, $RUNS run(s)"
for n in $(seq 1 "$RUNS"); do
  paint="$(run_once "$n")"
  SAMPLES+=("$paint")
  echo "  run $n: ${paint} ms"
done

BEST="${SAMPLES[0]}"
for value in "${SAMPLES[@]}"; do
  [ "$value" -lt "$BEST" ] && BEST="$value"
done

BUDGET="$(awk -v max="$MAX_MS" -v factor="$HOST_FACTOR" 'BEGIN { printf "%.0f", max * factor }')"
CORES="$(nproc 2>/dev/null || echo unknown)"

if [ "$JSON" -eq 1 ]; then
  printf '{"samples":%s,"bestMs":%s,"budgetMs":%s,"maxMs":%s,"hostFactor":%s,"cores":%s}\n' \
    "$(printf '%s\n' "${SAMPLES[@]}" | paste -sd, -)" "$BEST" "$BUDGET" "$MAX_MS" "$HOST_FACTOR" "\"$CORES\""
fi

echo "best: $BEST ms (budget $BUDGET ms = $MAX_MS x $HOST_FACTOR; $CORES cores)"
if [ "$BEST" -gt "$BUDGET" ]; then
  echo "error: first paint ${BEST} ms exceeds the ${BUDGET} ms budget by $((BEST - BUDGET)) ms" >&2
  exit 1
fi
echo "ok: first paint within budget"

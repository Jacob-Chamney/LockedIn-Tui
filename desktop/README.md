# LockedIn desktop

Flutter frontend for LockedIn. The Bun core in `../src/` stays authoritative;
this app talks to it over newline-delimited JSON-RPC on stdio.

## Prerequisites

- Flutter **3.50 stable** (Dart 3.14)
- Linux: `clang`, `cmake`, `ninja`, `pkg-config`, `libgtk-3-dev`
- Bun 1.4 for the core
- Windows builds need Visual Studio 2022 with the Desktop C++ workload

Install Flutter once outside the repository:

```sh
git clone --depth 1 --branch stable https://github.com/flutter/flutter.git \
  "${FLUTTER_HOME:-$HOME/.local/share/flutter}"
source scripts/desktop-env.sh
flutter doctor
```

## Run

```sh
source scripts/desktop-env.sh
scripts/desktop-dev.sh        # flutter run -d linux
```

`CoreStore` spawns the Bun sidecar (`bun run ../src/server/main.ts`) from the
`desktop/` working directory. `LOCKEDIN_WORKSPACE` and `LOCKEDIN_DATA_DIR` are
inherited if you want a non-default workspace. The shell renders immediately and
shows `core offline` if the sidecar cannot start.

## Check

```sh
scripts/desktop-check.sh
```

This runs `dart format --set-exit-if-changed`, `flutter analyze`, `flutter test`,
the Bun typecheck, and the core protocol tests.

## Build

```sh
scripts/desktop-build.sh linux
scripts/desktop-build.sh windows   # on Windows
```

The script compiles the Bun core with `bun build --compile` and copies
`lockedin-core` (`lockedin-core.exe` on Windows) next to the app executable.
`CoreStore` prefers that sidecar, so the packaged app needs no Bun install; in
development it falls back to `bun run ../src/server/main.ts`.

### Linux renderer

The pinned Flutter is **3.50.1**, which fixes the NVIDIA OpenGL offset bug
(flutter/flutter#195885). The runner uses the engine's default renderer;
`FLUTTER_LINUX_RENDERER` is available as the engine's own override.

## Layout

```
desktop/
  lib/
    app.dart              MaterialApp + theme
    shell/                top bar, sidebar, status, surface switch
    theme/                crimson palette (mirrors src/ui/theme)
    bridge/               JSON-RPC client and protocol models
    features/chat/        chat placeholder (T-003)
    features/stats/       stats placeholder + CustomPainter chart (T-004)
    features/placeholder/ sessions/sources/settings placeholders
  test/                   widget smoke tests
  docs/architecture.md    layers, lifecycle, state ownership
  docs/protocol.md        shell ↔ core contract
  docs/licensing.md       Flutter/Dart licences and app-licence note
  tasks/                  multiagent packets (T-001…T-007)
  PLAN.md                 phases and task board
  AGENTS.md               ownership and rules for agents
```

## Status

Phase 0 scaffold: shell, theme, chat/stats placeholders, core protocol scaffold,
tests, scripts. See `PLAN.md` for the next packets.

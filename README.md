# LockedIn-Tui

**A keyboard-first terminal workspace for learning and focused work.**

[![Latest release](https://img.shields.io/github/v/release/Jacob-Chamney/LockedIn-Tui?style=flat-square)](https://github.com/Jacob-Chamney/LockedIn-Tui/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey?style=flat-square)](#install)

LockedIn-Tui is a single binary that opens a complete study and work
environment in your terminal: a streaming chat, source-grounded study sessions,
learning goals and lessons, project workspaces, and a navigable map of your
notes. Your notes are plain Markdown on disk. There is no account, no telemetry
and no runtime to install.

<img src="assets/screenshots/chat.png" alt="LockedIn-Tui chat with a conversation in progress" width="100%">

## What you get

### Chat that stays out of your notes

A focused conversation with streaming answers and a stop key. Chill chat is
read-only by design: it never writes to your workspace and keeps its history
local.

### Lock-in sessions grounded in your sources

<img src="assets/screenshots/manager-sessions.png" alt="Study session manager listing sessions with source and step counts" width="100%">

Choose the files and notes a session may use. Lock-in builds steps and answers
from those sources, labels earlier history, and keeps the session's progress in
Markdown.

### Learning goals, curricula and lessons

<img src="assets/screenshots/course.png" alt="A generated lesson beside the skill session chat" width="100%">

Turn a goal into a curriculum and work through generated lessons. Progress is
stored as checkboxes in your notes, so it survives restarts and stays readable
outside the app.

<img src="assets/screenshots/knowledge.png" alt="Knowledge map of notes grouped by topic" width="100%">

### A map of everything you have written

Knowledge indexes your Markdown vault and gives you a keyboard-navigable graph
of topics and notes, plus full-text search. On terminals with image support the
map is drawn in pixels; everywhere else it falls back to a tree.

<img src="assets/screenshots/achievements.png" alt="Achievements inventory" width="100%">

### Projects, agents, stats and achievements

Project buffers keep a reusable working context with agent profiles. Lifetime
counters and achievements show what you have actually done, without turning
study into a game you have to feed.

## Install

Download the binary for your machine from the
[latest release](https://github.com/Jacob-Chamney/LockedIn-Tui/releases/latest).
There is no runtime, no package manager and no `node_modules`. The binary uses
the operating system's C library; Alpine also needs the standard `libstdc++`
package.

| Platform | Artifact | Status |
|---|---|---|
| Linux x64 (glibc) | `lockedin-1.0.0-bun-linux-x64` | verified |
| Linux x64 (musl / Alpine) | `lockedin-1.0.0-bun-linux-x64-musl` | verified in Alpine |
| Linux arm64 (glibc) | `lockedin-1.0.0-bun-linux-arm64` | verified |
| Linux arm64 (musl) | `lockedin-1.0.0-bun-linux-arm64-musl` | verified in Alpine |
| macOS arm64 (Apple Silicon) | `lockedin-1.0.0-bun-darwin-arm64` | verified |
| macOS x64 (Intel) | `lockedin-1.0.0-bun-darwin-x64` | verified |
| Windows x64 | `lockedin-1.0.0-bun-windows-x64.exe` | verified |

`verified` means release CI launched the binary and painted its first screen on
native hardware, or inside an Alpine container on the matching architecture for
musl. On Alpine, install the standard C++ runtime first:

```sh
apk add libstdc++
```

Full instructions, including arm64 and musl choices, are in
[`docs/install.md`](docs/install.md).

**Unsigned builds.** The 1.0 binaries are not code-signed. Verify
`SHA256SUMS` first. macOS may quarantine a browser download
(`xattr -d com.apple.quarantine ./lockedin`); Windows SmartScreen may offer
**More info → Run anyway**. The `curl` and PowerShell commands above do not
bypass the checksum step.

### Linux (glibc, x64)

```bash
VERSION=1.0.0
BASE="https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v$VERSION"
curl -fsSL -o "lockedin-$VERSION-bun-linux-x64" \
  "$BASE/lockedin-$VERSION-bun-linux-x64"
curl -fsSL -O "$BASE/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS
chmod +x "lockedin-$VERSION-bun-linux-x64"
mkdir -p ~/.local/bin
install -m 0755 "lockedin-$VERSION-bun-linux-x64" ~/.local/bin/lockedin
```

### macOS (Apple Silicon)

```bash
VERSION=1.0.0
BASE="https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v$VERSION"
curl -fsSL -o "lockedin-$VERSION-bun-darwin-arm64" \
  "$BASE/lockedin-$VERSION-bun-darwin-arm64"
curl -fsSL -O "$BASE/SHA256SUMS"
grep "lockedin-$VERSION-bun-darwin-arm64" SHA256SUMS | shasum -a 256 -c -
chmod +x "lockedin-$VERSION-bun-darwin-arm64"
mkdir -p ~/.local/bin
install -m 0755 "lockedin-$VERSION-bun-darwin-arm64" ~/.local/bin/lockedin
```

### Windows (PowerShell, x64)

```powershell
$VERSION = "1.0.0"
$BASE = "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v$VERSION"
Invoke-WebRequest "$BASE/lockedin-$VERSION-bun-windows-x64.exe" -OutFile lockedin.exe
Invoke-WebRequest "$BASE/SHA256SUMS" -OutFile SHA256SUMS
$expected = (Select-String -Path SHA256SUMS -Pattern "lockedin-$VERSION-bun-windows-x64.exe").Line.Split()[0]
$actual = (Get-FileHash .\lockedin.exe -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw "checksum mismatch" }
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Programs\LockedIn" | Out-Null
Move-Item -Force .\lockedin.exe "$env:LOCALAPPDATA\Programs\LockedIn\lockedin.exe"
```

Add `%LOCALAPPDATA%\Programs\LockedIn` to your `PATH`, then open a new terminal.

### First run

```bash
lockedin --version
lockedin
```

The first run creates a workspace at `~/LockedIn` (or the path passed to
`--workspace`) with `school/`, `skills/`, `work/` and `input/`. `Ctrl+Q` quits,
`?` opens help. If `~/LockedIn` belongs to the older Python version, LockedIn
explains and uses `~/LockedIn-Tui` instead of touching it.

### Updates

LockedIn checks the public release feed once per launch. When a newer version
exists, the top bar shows `↑ <version> · :update`. Run `:update` to download the
build for your platform, verify it against the release's `SHA256SUMS`, and
replace the binary. Quit and reopen to use the new version.

Updates are never installed automatically. There is no background service and
no retry. If the install directory is read-only, the error names the asset and
the release page so you can install it manually.

Requirements: a truecolor terminal (Ghostty, Kitty, WezTerm, Windows Terminal,
iTerm2) or a plain `xterm-256color` fallback, and at least 80×24 cells. Provider
API keys are stored in the operating system keychain, never in config files.

## Privacy

- Notes, sessions and outputs are Markdown and JSON in your workspace.
- Usage, history and logs live in the platform data directory, not the vault.
- No account, no analytics and no background service.
- The only automatic background request is a release check to GitHub once per
  launch. It sends no workspace data; `:update` is the only download.
- Secrets go only to the OS keychain.

## Roadmap

What comes next is in [`ROADMAP.md`](ROADMAP.md).

## License

MIT. See [`LICENSE`](LICENSE). The binary embeds Bun, OpenTUI and other
libraries; their notices are in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

---

Bugs and feature requests: [Issues](https://github.com/Jacob-Chamney/LockedIn-Tui/issues).
Questions and ideas: [Discussions](https://github.com/Jacob-Chamney/LockedIn-Tui/discussions).
Security reports: see [`SECURITY.md`](SECURITY.md).

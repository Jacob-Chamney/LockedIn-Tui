# LockedIn-Tui

[![CI](https://github.com/Jacob-Chamney/LockedIn-Tui/actions/workflows/ci.yml/badge.svg)](https://github.com/Jacob-Chamney/LockedIn-Tui/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

A keyboard-first terminal workspace for learning and focused work. It runs
inside your terminal, uses the terminal's own GPU rendering, and keeps your
workspace on your machine.

## Features

- **Chat and lock-in sessions** with your configured model provider.
- **Skill sessions and a reader** with goals, sources and generated study
  material.
- **Work projects and agents** with review queues, change sets and project
  memory.
- **Archive and sources** with a local index, search and export.
- **Usage and budgets** with provider cost tracking.
- **Keyboard-first navigation** with a discoverable leader keymap.
- **Terminal images** for achievements and visual content when the terminal
  supports Kitty graphics or Sixel.
- **MCP plugins** with per-command policy and approval for write tools.

## Install

> **1.0.0 is being prepared.** Until it is published, `latest` still points at
> the previous 1.x release. Use the source instructions below to run this tree.

Install the latest release:

```sh
curl -fsSL https://github.com/Jacob-Chamney/LockedIn-Tui/releases/latest/download/install.sh | sh
```

The installer detects the platform, verifies the artifact against the release
`SHA256SUMS`, and installs to `~/.local/bin/lockedin`. It never uses `sudo` and
never edits your shell profile.

Supported platforms: Linux x64/arm64 (glibc and musl), macOS arm64/x64 and
Windows x64.

### Manual install

Download the asset for your platform, mark it executable and run it:

```sh
chmod +x lockedin-1.0.0-bun-linux-x64
./lockedin-1.0.0-bun-linux-x64 --workspace ~/LockedIn
```

## Run from source

Requirements: [Bun](https://bun.sh) **1.4.4** and Git.

```sh
bun install --frozen-lockfile
bun run start
```

The first run creates a workspace at `~/LockedIn`. Use `--workspace <path>` or
`LOCKEDIN_WORKSPACE` to choose another folder.

```sh
bun run start --workspace ~/Learning
```

## Development

`bun run check` is the full gate: boundary checks, typecheck, the test suite and
the startup budget.

```sh
bun run check
```

Layout:

```
src/        application code
tests/      unit, contract, integration, invariant, UI and end-to-end tests
scripts/    build, check and performance tooling
licenses/   third-party licence texts
```

## Security

Report vulnerabilities privately through the repository's Security tab. See
[SECURITY.md](SECURITY.md). Do not open a public issue for a security problem.

## Contributing

Contributions are accepted under the Developer Certificate of Origin. See
[CONTRIBUTING.md](CONTRIBUTING.md) and sign commits with `git commit -s`.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE) and [TRADEMARK.md](TRADEMARK.md).

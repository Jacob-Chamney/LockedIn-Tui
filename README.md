# LockedIn-Tui

A keyboard-first terminal workspace for learning and focused work.

This is the canonical application source. The app runs inside your terminal,
uses the terminal's own GPU rendering, and opens every screen from the
keyboard.

## Build

Requirements: [Bun](https://bun.sh) **1.4.4** and Git.

```sh
bun install --frozen-lockfile
bun run start
bun run check
```

`bun run check` is the full gate: boundary checks, typecheck, the test suite and
the startup budget.

## Layout

```
src/        application code
tests/      unit, contract, integration, invariant, UI and end-to-end tests
scripts/    build, check and performance tooling
assets/     application assets
licenses/   third-party licence texts
```

## Releases

Releases are one version with native binaries for every supported target:
Linux x64/arm64 (glibc and musl), macOS arm64/x64 and Windows x64.

The TUI assets are raw binaries. After downloading one, mark it executable:

```sh
chmod +x lockedin-1.0.0-bun-linux-x64
./lockedin-1.0.0-bun-linux-x64 --workspace ~/LockedIn
```

Or install the latest release:

```sh
curl -fsSL https://github.com/Jacob-Chamney/LockedIn-Tui/releases/latest/download/install.sh | sh
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are accepted under the
Developer Certificate of Origin; sign commits with `git commit -s`.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE) and [TRADEMARK.md](TRADEMARK.md).

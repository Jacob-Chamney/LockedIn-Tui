# LockedIn

A keyboard-first desktop workspace for learning and focused work. The shell is
Flutter; the engine is Bun + TypeScript. Your workspace is plain Markdown on
your machine.

There is one frontend: the desktop app. The terminal frontend this project
started from has been removed.

## What it does

- **Chill** — ask anything. Tool-free, read-only, streaming, local history.
- **Teaching** — measure what you hold, plan the shortest route, teach one
  reasoning step with a check, repair a miss, then practise. Steps can cite the
  sources they came from or are labelled `agent explanation`.
- **Lock-in** — keep a real assignment moving: sources copied into the session,
  an ordered step list, one step in front of you, no teaching prose.
- **Outputs** — study guides, flashcards with spaced review, and per-session
  documents (contract, contradictions, attempt check).
- **Work** — register a local project, talk to a read-only agent, review writes
  per hunk, approve commands separately, run a read-only swarm.
- **Review** — the actionable queue: due/missed cards, open steps and stages;
  session memory is labelled history, not work.
- **Knowledge** — search and read notes, session memory, sources, goals,
  projects, archive entries, and the learning graph that links them.
- **Archive, Stats, Achievements** — local or private GitHub archive with
  consent and a privacy check; usage and cost; a progress map.

Keys are the primary input: every action has a binding, the leader overlay shows
the real bindings, and the app is usable at 800×600. Themes are semantic tokens,
so a colour never changes meaning.

## Build from source

Prerequisites: **Bun 1.4.4**, **Flutter 3.50 (stable)**, and on Linux the GTK
development packages (`libgtk-3-dev libblkid-dev liblzma-dev`). Document
extraction uses `poppler-utils` (`pdftotext`, `pdftoppm`); tests that need it
skip with an install hint when it is absent.

```bash
bun install
source scripts/desktop-env.sh   # puts the pinned Flutter SDK on PATH
cd desktop && flutter pub get && cd ..

scripts/desktop-check.sh        # format, analyze, widget tests, core tests
scripts/desktop-build.sh linux  # Flutter shell + compiled Bun core sidecar
scripts/desktop-package.sh      # tarball under dist/
scripts/desktop-install.sh      # per-user Linux install
```

Windows uses `scripts/desktop-build.sh windows`, `desktop-package.ps1` and
`desktop-installer.ps1`. The release workflows build both platforms.

## Architecture

```
desktop/ (Flutter, Dart)  ── stdio JSON-RPC ──▶  src/server/ (Bun, TypeScript)
  shell, theme, features                          boot, services, events
```

- `src/domain`, `src/services`, `src/storage`, `src/stats`, `src/llm`, `src/mcp`,
  `src/security` hold the rules and the files. They never import the shell.
- `src/server/` is a thin JSON-RPC adapter over those services. stdout is
  protocol only; logs go to stderr.
- `desktop/lib/bridge/protocol.dart` mirrors the wire contract in
  `desktop/docs/protocol.md`.
- The shell owns window geometry, focus and transient dialogs. It does not read
  files, hold secrets or re-derive totals. Provider keys live in the OS keychain.
- Sources are copied into a session; the school/skills wall and the work-project
  root are enforced by path-scoped services, not by prompt text.

## Data

The workspace is a directory of Markdown and JSON that you can read and edit
without the app. The search index is a rebuildable cache. App data (stats,
usage, logs) lives outside the workspace in the platform data directory.
Accounts, sync and telemetry are not part of the product.

## Licence

AGPL-3.0-only. See `LICENSE` and `THIRD-PARTY-NOTICES.md`.

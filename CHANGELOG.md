# Changelog

All notable user-visible changes to LockedIn-Tui. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-07

### Added

- Initial 1.0.0 release.
- Chill chat: streaming answers, cancellation, local history, and a read-only
  transcript that never writes to the workspace.
- Lock-in study sessions grounded in selected sources, with steps, progress and
  labelled history.
- Skills: learning goals, curricula, lessons, generated guides and flashcards.
- Projects and Work buffers with reusable agent profiles.
- Knowledge: a Markdown-vault graph, keyboard navigation and full-text search.
- Achievements, lifetime stats and an activity log.
- Local archive support: a folder backend and a GitHub backend.
- MCP plugin servers with a per-server policy.
- Themes, rebindable keys, and a help overlay driven by the keymap registry.
- Single-binary distribution for Linux, macOS and Windows. No runtime, no
  `node_modules`, no background service.
- In-app update check and `:update`: downloads the build for the current
  platform, verifies the release checksum and replaces the binary. Updates are
  user-triggered and never installed automatically.
- Markdown as the source of truth, a rebuildable SQLite index, and
  keychain-only secrets.

[Unreleased]: https://github.com/Jacob-Chamney/LockedIn-Tui/releases

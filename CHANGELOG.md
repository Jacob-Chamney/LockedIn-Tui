# Changelog

All notable user-visible changes to LockedIn-Tui. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
`1.<features>.<fixes>`: the minor grows with the number of features added, the
patch with the number of bugs fixed, and the major changes only by decision.

## [Unreleased]

## [1.4.4] - 2026-11-07

### Added

- Starting a lock-in session now offers a choice between writing assignment
  instructions and browsing for a PDF, DOCX or text file. A file is copied into
  the session, its text is extracted into `prompt.md`, and its provenance is
  recorded in `meta.json`.

### Fixed

- Assignment steps and headings wrap to the reader width with a hanging indent.
  The reader clips its body to the pane, keeps the footer visible, and always
  keeps the selected step on-screen.
- The Explorer now separates the active session from the session library with a
  divider and a `SESSIONS` heading.

## [1.3.2] - 2026-11-07

### Added

- Session settings in the Explorer: edit the assignment instructions, load a
  PDF, DOCX or text file as the instructions, and re-extract the copied
  original. The original file is kept in the session and its provenance is
  recorded in `meta.json`.
- `/regenerate-steps` in a lock-in chat rebuilds the steps from the session
  sources without sending a model message or writing to the chat history.

### Fixed

- Lock-in chat, step generation, study guides and flashcards now read PDF and
  DOCX sources through the extraction service instead of silently skipping
  them. The extracted text is cached by content hash.
- Step generation reads the assignment instructions first, excludes the old
  steps and generated outputs from its context, preserves the assignment's
  order and terminology, and reports unreadable sources with the file name and
  reason instead of producing a partial plan.

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
- One-command installer: `curl -fsSL .../releases/latest/download/install.sh | sh`
  detects the OS, architecture and libc, verifies `SHA256SUMS` and installs
  `~/.local/bin/lockedin`.
- Markdown as the source of truth, a rebuildable SQLite index, and
  keychain-only secrets.

[Unreleased]: https://github.com/Jacob-Chamney/LockedIn-Tui/releases

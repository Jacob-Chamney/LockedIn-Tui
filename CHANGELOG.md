# Changelog

All notable user-visible changes to LockedIn-Tui. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
`1.<features>.<fixes>`: the minor grows with the number of features added, the
patch with the number of bugs fixed, and the major changes only by decision.

## [Unreleased]

## [1.6.0] - 2026-11-11

### Added

- A short startup splash: a theme-coloured ASCII code field fades in, assembles
  a padlock with one hinged leg, slides the other leg shut and fades out before
  the app mounts. The field shimmers while the lock is on screen.
  `Esc`/`Enter`/`Space` skips it; `LOCKEDIN_REDUCED_MOTION=1` or
  `LOCKEDIN_NO_SPLASH=1` disables it.
- A multifunctional file finder for sources, gathered skill material and
  assignment instructions. Search is ranked and debounced, defaults to the
  home directory (`Ctrl+F` switches to the current folder), includes folders,
  and pins a typed path above the matches. The highlighted file previews below
  the list, and `Tab` opens a selection pane where `d` removes a mark.

### Fixed

- `A` marks the folder under the cursor; it previously reviewed instead, so
  recursive folder marking was unreachable. Enter on a source now goes to the
  review step instead of skipping it, and a single-file picker chooses its file
  immediately.
- Finder navigation, marking and removal now keep the live result marks in
  sync; a search that finishes after you open a folder or reveal a file no
  longer repaints the old view.
- The finder preview keeps empty text files and text whose byte cap lands
  inside a multi-byte character as text, not binary.

## [1.5.1] - 2026-11-11

### Fixed

- Chat bubble corners no longer collapse into a floating square when the
  terminal uses the cell fallback: only the outer quarter cell is cut now, so
  the bubble reads as rounded. Image-capable terminals keep the raster cap even
  when the pixel-size reply is missing, including when the window is small.

## [1.5.0] - 2026-11-11

### Added

- A dedicated Chat settings window opened from Settings for response style
  (brief, normal, detailed) and tutor policy (direct, guided, socratic), with a
  live style line below the composer.
- Rounded chat bubbles with distinct user and assistant backgrounds, `you` /
  `locked in` labels, streaming and truncated replies. While a reply is in
  flight the bubble says `Thinking…` with a quiet pulse; `LOCKEDIN_REDUCED_MOTION=1`
  holds it still. The corners are drawn as
  opaque cap images on terminals that support them, so the fill reaches a real
  curve; anywhere else they fall back to cell chamfers.
- `:clear` empties the Chill transcript and its local history. A reply that is
  still streaming has to be stopped first.
- Syntax highlighting for around 340 languages, bundled with the app: no
  parser downloads and no per-platform grammar. Code follows the active theme.
- `:help`, `:next`, `:park`, `:questions`, `:calibrate`, `:contract`,
  `:contradictions`, `:check`, `:mistake` and `:rate` chat commands.
- Session learning files for parked questions, starting level, done-when
  contracts, source-conflict reports, attempt reviews, misconceptions and
  confidence ratings.
- Steps record the instructions and source hashes that produced them. Edited
  inputs mark the plan stale instead of silently leaving an old plan in place.
- Step generation now extracts concrete requirements, rejects generic
  standalone steps and performs one refinement pass when a plan is too broad.

### Changed

- Chat commands use `:` consistently: `:learning-web`, `:regenerate-steps` and
  the session learning commands. `/` is no longer the command prefix. Response
  style and tutor policy moved to the Chat settings window.
- A final answer over the total token budget is kept. The provider output
  ceiling is the hard length guard; a length stop keeps the partial answer and
  marks it truncated.

### Fixed

- Step regeneration accepts JSON wrapped in Markdown fences, trailing commas
  and literal newlines inside strings. A truncated or incomplete response now
  says so and asks for a retry instead of reporting a generic parse failure.

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
- `:regenerate-steps` in a lock-in chat rebuilds the steps from the session
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

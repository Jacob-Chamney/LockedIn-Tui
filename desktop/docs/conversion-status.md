# Desktop conversion status

Updated: 2026-11-16. Branch: `feat/flutter-desktop`.
The Bun core is authoritative; this document tracks the Flutter frontend only.

## Working today

| Area | State | Evidence |
|---|---|---|
| Core bridge | workspace, sessions list/open, stats, settings, Chill + session chat, provider link, settings patch | `src/server/protocol.ts`, protocol/data tests |
| Chill | streaming, cancel, draft, Markdown, usage, stopped/failed markers | `desktop/lib/features/chat`, widget tests |
| Markdown | headings, lists, code, checkboxes, quotes, tables, partial streams | `desktop/lib/features/chat/markdown.dart` |
| Command palette | `Ctrl+K`, one surface registry, refresh/retry | `desktop/lib/shell/palette.dart` |
| Stats | live summary, range/scope, area chart, model mix | `desktop/lib/features/stats` |
| Sessions | list, detail, source-bound chat, wizard and source picker | `desktop/lib/features/sessions`, `desktop/lib/features/sources` |
| Steps | selectable reader with atomic `Space`/`x` toggle | `desktop/lib/features/sessions/session_detail.dart` |
| Outputs | study guide + answers, flashcard deck (flip/known/missed), build/read/rebuild | `desktop/lib/features/sessions/session_outputs.dart`, `deck.dart` |
| Skills lessons | curriculum stages, lesson reader, citations, draft build | `desktop/lib/features/skills/skill_lesson.dart` |
| Review | queue, side filter, diagnostics, known/missed marking | `desktop/lib/features/review` |
| Archive | list both sides, restore and delete on both sides and backends | `desktop/lib/features/archive` |
| Coverage | `session.coverage`, a COVERAGE card and a Review summary line | `src/server/protocol.ts`, `desktop/lib/features/sessions/session_detail.dart` |
| Decision layer | `decision.get/set`, rules-only, honest "not shipped" model row | `src/server/protocol.ts`, `desktop/lib/features/settings/settings_page.dart` |
| Knowledge | `knowledge.search`/`tree`/`read`, scope chips and a reader with hit navigation | `src/server/protocol.ts`, `desktop/lib/features/knowledge/` |
| Commands | `:` line derived from the registry, with the documented aliases | `desktop/lib/shell/command_line.dart` |
| Swarms | `work.swarm.*` and the Work board with cancel/remove/retry | `desktop/lib/features/work/swarm_page.dart` |
| Keybinds | registry-driven shell, Ctrl+K palette, Space leader, Settings editor | `desktop/lib/keymap/`, `desktop/lib/shell/leader.dart` |
| Plugins | per-call write consent with `mcp.permission` / `mcp.confirm` | `desktop/lib/shell/plugin_permission.dart` |
| Screenshots | 14 isolated shots across the surfaces + 800x600 (pre-dates Knowledge) | `desktop/docs/screenshots/` |
| Settings | connect-model flow, scalar editors, MCP servers/policy, theme picker | `desktop/lib/features/settings` |
| Themes | crimson, high contrast, Claude Code and Codex palettes, live switch | `desktop/lib/theme/palette.dart` |
| Packaging | Linux tarball + Windows zip script with core, native keychain addon, licence and notices | `scripts/desktop-package.sh`, `.ps1` |
| NVIDIA | software-renderer fallback for the Flutter 3.50.0 compositor offset | `desktop/linux/runner/my_application.cc`, T-002 |
| Tests | 726 Flutter, 3527 Bun, analyze/format clean | `scripts/desktop-check.sh`, `bun run check` |

## In flight (this wave)

| Packet | Owner | Scope |
|---|---|---|
| None — this wave is integrated | | |

## Next waves

| Packet | Owner | Scope |
|---|---|---|
| T-045 | settings | rebindable keymap registry and global write/command opt-ins |
| T-046 | chat | Chill image attach UI (in flight) |
| T-047 | work-agents | Project swarms and task board |
| T-048 | qa | Archive delete and goal restore (in flight) |
| T-049 | qa | Decision layer and plugin permission gate |
| T-050 | qa | Real Windows build, signing and install/uninstall |

## Rules

- One packet, one owner, one file set; see `AGENTS.md` and `tasks/`.
- The core is authoritative; pages receive projections and send intents.
- Every packet runs `scripts/desktop-check.sh`; protocol changes also run the
  Bun bridge tests.
- No secrets, personal paths or real usage data in screenshots or fixtures.

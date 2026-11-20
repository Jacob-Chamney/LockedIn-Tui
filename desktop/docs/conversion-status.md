# Desktop conversion status

Updated: 2026-11-20. Branch: `feat/flutter-desktop`.
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
| Themes | crimson, high contrast, Claude Code and Codex palettes, live switch, custom palette editor | `desktop/lib/theme/palette.dart`, `desktop/lib/features/settings` |
| Achievements | `achievements.list`, the star field, unlock dates in the data dir | `desktop/lib/features/achievements/` |
| Agent templates | `work.templates.list`, the picker that seeds an agent profile | `desktop/lib/features/work/agent_dialog.dart` |
| Activity log | `activity.list`, kind/project filters, a read-only page | `desktop/lib/features/work/activity_page.dart` |
| Review marking | `review.mark` for a step, a card and a stage; the row shows `marking…` | `desktop/lib/features/review/` |
| Keybind editor | `keybinds.get/set`, capture, conflict refusal, reset one/all | `desktop/lib/features/settings/keybinds_section.dart` |
| Images | Chill attach: picker, four per message, vision-model copy | `desktop/lib/features/chat/chat_page.dart` |
| Effects | palette-driven confetti and the particle registry | `desktop/lib/effects/` |
| Packaging | Linux tarball + Windows zip script with core, native keychain addon, licence and notices | `scripts/desktop-package.sh`, `.ps1` |
| NVIDIA | software-renderer fallback for the Flutter 3.50.0 compositor offset | `desktop/linux/runner/my_application.cc`, T-002 |
| Tests | 945 Flutter widget tests, 3,635 Bun, analyze/format/`tsc` clean | `scripts/desktop-check.sh` — it runs the whole core suite, not four files |

## In flight (this wave)

| Packet | Owner | Scope |
|---|---|---|
| None — this wave is integrated | | |

## Next waves

None queued. Everything T-045…T-050 that used to be listed here has shipped:
the keybind registry and write/command opt-ins, Chill image attach, swarms and
the task board, archive delete and goal restore, the decision layer and plugin
permission gate, and the Windows build. What remains is not a wave — signing
(Authenticode certificate) and a clean-machine install — and both are tracked
in `PLAN.md` § Phase 5.

## Rules

- One packet, one owner, one file set; see `AGENTS.md` and `tasks/`.
- The core is authoritative; pages receive projections and send intents.
- Every packet runs `scripts/desktop-check.sh`; protocol changes also run the
  Bun bridge tests.
- No secrets, personal paths or real usage data in screenshots or fixtures.

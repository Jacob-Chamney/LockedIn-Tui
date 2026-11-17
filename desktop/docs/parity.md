# Desktop parity audit

Status of the Flutter desktop app against `docs/product.md` §14. This is the
document a reviewer reads before calling the conversion complete: every row says
where the behaviour lives and what proves it, or says plainly that it is missing.

Updated: 2026-11-17. Branch: `feat/flutter-desktop`.

**Legend** — `done` = implemented and covered by a test; `partial` = the main
path works and a named piece is missing; `missing` = no code; `blocked` = cannot
be verified in this environment.

## Chill

| Item | State | Where | Evidence |
|---|---|---|---|
| streaming, cancellation, thinking block, status metrics | done | `desktop/lib/features/chat/` | `chat_page_test.dart`, `chat_markdown_test.dart` |
| local history limit and clear | done | `desktop/lib/bridge/core_client.dart` | `core_store_test.dart` |
| image attachments | done | `chat_page.dart`, `src/llm/chat.ts` | `chat_images_test.dart`, `chat-images.test.ts` |
| multiline input | done | `chat_page.dart` | `chat_page_test.dart` |

## Lock-in

| Item | State | Where | Evidence |
|---|---|---|---|
| wizard, source copy, prompt, steps, review | done | `features/sessions/new_session.dart` | `new_session_test.dart` |
| source-bound chat, labelled history | done | `session_chat.dart`, `src/server/protocol.ts` | `session_detail_test.dart`, `server-session-chat.test.ts` |
| memory extraction | done | `src/server/protocol.ts` (`recordTurn`) | `server-session-memory.test.ts`, `session_memory_test.dart` |
| session opens on chat | done | `shell.dart` | `shell_session_test.dart` |
| manager: sort/search/reopen/archive/delete/export | done | `sessions_page.dart` | `sessions_test.dart`, `sessions_sort_test.dart`, `session_actions_test.dart` |
| source adding to an existing session | done | `features/sources/`, `source.add` | `sources_test.dart` |
| session settings (prompt, import, re-extract) | done | `session_settings.dart` | `session_settings_test.dart` |

## Outputs

| Item | State | Where | Evidence |
|---|---|---|---|
| steps with atomic toggles and merge-on-regenerate | done | `session_detail.dart`, `session.generateSteps` | `session_detail_test.dart`, `server-generate-steps` |
| study guide + answers | done | `session_outputs.dart` | `session_outputs_test.dart` |
| flashcards flip + multiple choice | done | `deck.dart`, `session_outputs.dart` | `deck_test.dart` (flip, `1`–`4`, known/missed, shuffle, missed-only) |
| context-aware generation | done | `session.output.build` | `session_outputs_test.dart` |
| outputs open in reader | done | `session_outputs.dart` | `session_outputs_test.dart` |

## Learning

| Item | State | Where | Evidence |
|---|---|---|---|
| review queue | done | `features/review/` | `review_test.dart` |
| adaptive nudges | done | `src/domain/review.ts` | `server-review.test.ts` |
| source coverage | done | `session.coverage`, detail card | `coverage_test.dart`, `server-coverage.test.ts` |
| knowledge base | done | `features/knowledge/`, `knowledge.*` | `knowledge_test.dart`, `knowledge_reader_test.dart`, `server-knowledge*.test.ts` |
| achievements | done | `features/achievements/`, `achievements.list` | `achievements_test.dart`, `server-achievements.test.ts` |
| stats | done | `features/stats/` | `stats_page_test.dart` |

## Skills

| Item | State | Where | Evidence |
|---|---|---|---|
| goal wizard | done | `goal_wizard.dart` | `goal_wizard_test.dart` |
| editable curriculum | done | `skill_detail.dart`, `skill.stages.save` | `skill_stages_test.dart`, `server-skill-stages.test.ts` |
| gathered sources with excerpts | done | `skill_detail.dart`, `skill.sources.*` | `skill_sources_test.dart` |
| staged lessons with citations | done | `skill_lesson.dart` | `skill_lesson_test.dart` |
| multiple chats | done | `skill_chat.dart`, `core_client.dart` | `Shift+N`, the app-bar icon and the card's `New chat` call `skill.chat.create`; `c` still resumes the newest. `skill_chat_test.dart` |
| progress and manager actions | done | `skills_page.dart`, `skill.archive/remove/export` | `skills_actions_test.dart`, `server-skill-stages.test.ts` |

## Work

| Item | State | Where | Evidence |
|---|---|---|---|
| project registration and chat entry | done | `work_page.dart`, `work.create` | `work_test.dart` |
| project chat, read-only default | done | `work_chat.dart` | `work_chat_test.dart` |
| write opt-in, per-write approval, per-hunk review | done | `work_approvals.dart`, `work.permissions.*` | `work_optin_test.dart`, `server-work-optin.test.ts` (two gates, then per-hunk review) |
| command opt-in + per-command approval | done | `work_approvals.dart`, `work.permissions.*` | `work_optin_test.dart`, `server-work-optin.test.ts` |
| agent profiles, templates, default agent | done | `agent_dialog.dart`, `work.templates.list` | `work_agent_test.dart`, `work_templates_test.dart`, `server-work-templates.test.ts` |
| saved chats | done | `work_chat.dart` | `work_chat_test.dart` |
| swarms with cap, cancel, board, report, retry | done | `swarm_page.dart`, `work.swarm.*` | `work_swarm_test.dart`, `server-swarm.test.ts` |
| changes summary | done | `work_page.dart`, `work.changes` | `work_changes_test.dart` |
| activity log | done | `features/work/activity_page.dart`, `activity.list` | `work_activity_test.dart`, `server-activity.test.ts` |

## Shared

| Item | State | Where | Evidence |
|---|---|---|---|
| crimson + high contrast + Codex/Claude + palettes + custom | done | `theme/palette.dart`, `theme.custom.*` | `theme_test.dart`, `theme_custom_test.dart`, `server-theme-custom.test.ts`; the OpenCode palette set is deliberately not exposed |
| modal editing and mode correctness | done | `shell.dart` | `shell_session_test.dart`, `chat_page_test.dart` |
| keymap registry, conflict check, generated help/overlay | done | `keymap/`, `shell/leader.dart` | `keymap_test.dart`, `shell_leader_test.dart` |
| explorer grouping, counts, contextual rows | done | `shell.dart` sidebar | ten surfaces with shortcuts and hints, plus `RECENT`: the three newest readable sessions (`name · date`), newest first, opening that session. `shell_session_test.dart` |
| reader buffers, search, highlighting, dimming | done | `features/chat/{document_search,code_highlight}.dart` | `document_search_test.dart`, `markdown_highlight_test.dart` |
| providers, keychain, explicit model choice | done | `settings_page.dart`, keychain addon | `settings_test.dart`, packaged-addon proof |
| budget, usage, failure policy | done | `src/llm/budget.ts` | `bun run check` suites |
| MCP policy | done | `settings_page.dart` | `mcp_settings_test.dart`, `mcp_policy_test.dart` |
| archive folder + GitHub | done | `archive_page.dart`, `archive.*` | list, restore and delete on both sides and both backends; the session and skill managers push with `a` (`session.archive`, `skill.archive`) through the configured backend |
| settings sections | done | `settings_page.dart` | `settings_test.dart` |
| commands | done | `shell/command_line.dart` | `shell_command_test.dart` (registry-derived list, aliases, unknown input) |
| 80×24 usability | not applicable | — | desktop minimum is 800×600 (`desktop/AGENTS.md` §4) |
| packaging and install | **partial** | `scripts/desktop-*` | Linux tarball, Windows zip and an unsigned per-user NSIS setup all build in CI; the setup is installed and uninstalled on the runner before it is published. **Authenticode signing needs a certificate, and a clean-machine install is not verified** |

## Automation and optional features

| Item | State | Where |
|---|---|---|
| decision layer | done (rules-only) | `decision.get/set`; the local model is refused by design |
| plugin per-call consent | done | `shell/plugin_permission.dart`, `mcp.confirm` |
| plugin install flow | missing | out of scope v1 |

## Release verification (last run)

The Windows artifacts are built and exercised on the public repository's own CI
(run 44052202347), so the installer is proven by installing it:

```
desktop (windows x64)     success  8m25s
  ✓ Widget tests          810 passed
  ✓ Release build         lockedin-core.exe (release build, 2026.11.12)
  ✓ Package the zip       lockedin-desktop-windows-x64.zip   70,766,930 B (67.5 MiB)
  ✓ Build + verify setup  lockedin-desktop-windows-x64-setup.exe
                          52,124,694 B (49.7 MiB)
                          sha256 563512D74D7259AF78C8A487167E59D72561D578CEF55DE6FB859CD865829D0D
  ✓ verify: silent install   installed 145.9 MiB into
                             C:\Users\runneradmin\AppData\Local\Programs\LockedIn
  ✓ verify: silent uninstall clean, user data untouched
```

The **packaged core** was also driven through a real chat turn against a local
OpenAI-compatible SSE endpoint (a fake provider; loopback pricing is free):

```
config.toml       [models] chat = "custom/fake"  base_url = http://127.0.0.1:8123/v1
chat.send         {"text":"hi"}
chat.done         {"kind":"sent","requestId":"chat-1","outcome":"done"}
chat.state        status idle · model custom/fake · usage 17 tokens · 0 µUSD
                  messages: user "hi" (done), assistant "Hello from the sidecar." (done)
served            1 completion (no retry)
```

So the compiled sidecar's HTTP/SSE path, usage mapping and terminal event work
outside the test harness, not only under `bun test`.

The Linux release path was exercised end to end locally and offline:

```
scripts/desktop-package.sh -> dist/lockedin-desktop-linux-x64.tar.gz, 63 MB, 47 entries
packaged core handshake    -> protocol 1, 94 methods
theme.custom.set           -> {"background":"#0A1A2A"} ; "theme = \"custom\"" persisted
theme.custom.set (bad)     -> -32602 naming the token
work.permissions.get       -> {allowWrite: false, allowCommand: false}
achievements.list          -> 0 of 36 earned on a fresh workspace
activity.list              -> {"records": [], "skipped": 0, "empty": true}
custom palette in the app  -> theme row reads "custom"; app background sampled at
                              srgb(10,26,42) = #0A1A2A, primary still crimson
```

## Cross-cutting evidence

```
scripts/desktop-check.sh   format, analyze, 811 Flutter tests, 243 core contract tests
bun run check              3616 tests across 354 files (test:serial runs the same suite)
public clone, fresh        bun install --frozen-lockfile + bun run check: 3617 pass, 0 fail
scripts/desktop-package.sh 63 MB tarball: shell, core, keychain addon, licence, notices
scripts/desktop-smoke.sh   headless launch: window mapped, 1292 colours painted,
                           workspace.json written by the core, sidecar alive
scripts/desktop-installer.ps1 49.7 MiB NSIS setup, installed and uninstalled in CI
desktop/docs/screenshots/  17 captures across the surfaces
```

## Known blockers

1. **Windows — verified.** The private dev repository has no Actions minutes
   left, so its runs died at 2 s with zero steps and no runner. The public
   source repository has unlimited minutes, and the first real run there
   (44046003634, after PR #110 merged) passed both jobs:

   ```
   desktop (linux x64)    success  4m13s
   desktop (windows x64)  success  5m49s
     ✓ Analyze   ✓ Widget tests (806 passed)
     ✓ Release build with the core sidecar
         bundled core: …/Release/lockedin-core.exe (release build, 2026.11.12)
     ✓ Package the Windows zip
         lockedin-desktop-windows-x64.zip  70,766,930 bytes (67.5 MiB)
   ```

   Two Windows-only defects were found and fixed by that run: the sidecar
   environment built the keychain addon path with a hard-coded `/`, and two
   tests assumed POSIX execute bits and a 5 s FTS budget.

   The unsigned NSIS setup is built, installed and uninstalled on that runner
   (runs 44052202347 and 44055236021), so install/uninstall is no longer a gap.

   The native keychain addon is also proven there: the contract suite runs its
   round trip against `@napi-rs/keyring`, and on the Windows runner it reports

   ```
   secret store: native backend round-trip on win32
   (pass) secret store > native backend round-trips [40.18ms]
   ```

   so a secret is written, read back and deleted through Windows Credential
   Manager, not a shim.

   Still unproven on Windows: Authenticode signing (needs a code-signing
   certificate), a clean-machine install on a fresh VM and MSIX.
2. **No named gaps remain in this audit.** Everything `docs/product.md` §14
   lists for the desktop is implemented and covered, apart from Authenticode
   signing and a clean-machine install (above), the explicit v1 non-goal
   (`plugin install flow`) and the deliberately unexposed OpenCode palette set.

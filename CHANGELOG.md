## 2026-11-25 — desktop only

- The TUI frontend, its entrypoints, tests and OpenTUI/Solid dependencies are
  removed. The Flutter desktop app is the only frontend.
- The Bun core and the stdio JSON-RPC contract are unchanged; the core suite is
  the gate.

# Changelog

User-visible changes, newest first. The wiki [Releases](https://github.com/Jacob-Chamney/LockedIn-Tui/wiki/Releases)
page holds the published release notes; this file records entries as pull
requests merge.

## How entries are written

- Add entries under `Unreleased` in the pull request that makes the change.
- Use a user-facing sentence; a PR title may become the entry.
- Group with `Added`, `Changed`, `Fixed`, `Security` or `Removed`.
- Move `Unreleased` into the dated version when the release is published.
- Preserve author credit. See [CONTRIBUTING.md](CONTRIBUTING.md#changelog-and-credit).

## Unreleased

### Fixed

- Work projects can set instructions when they are created and edit them later:
  `work.instructions.save` writes only the project metadata, and the detail page
  has an `edit` control plus the `i` key. The old live error that promised a
  "later packet" is gone.
- `skill.stages.save` rewrites `curriculum.md` atomically, so the readable
  mirror always matches `meta.json`.
- Every corner radius in the shell comes from `Radii`; raw
  `BorderRadius.circular(n)` values are gone and a unit test fails on a new one.
  Pills use `Radii.pill`, controls `Radii.control`, floating layers
  `Radii.layer`.
- Every font size comes from the eight-step `TypeScale`; the 666 raw
  `fontSize: n` values are gone and a unit test fails on a new one. The goal
  wizard's review card yields its label to the chip, fixing a 3 px overflow at
  460 px.
- Settings has a `/` filter and a section index; the filter's field owns bare
  keys while focused, and the full page returns on `Esc`.
- The skill page is a learning surface first: the teaching loop and practice
  lead, a course's chapters follow, and sources, chats, research and goal
  metadata live behind one tab strip instead of four stacked cards. A measured
  goal's legacy stage list no longer competes with its learning tree.
- A goal chat at 980 px or wider keeps the learning tree beside the
  transcript; tapping a step opens it and returns to the goal. Narrow windows
  keep the chat full width.
- A window 1200 px or wider opens with the rail expanded, so destinations are
  labelled on first frame; narrower windows still start as icons. A later
  toggle is the user's.
- The Knowledge graph draws a deterministic canvas above its rows: nodes grouped
  by kind, edges as hairlines, the selected node labelled. Clicking a node
  selects it; the list keeps keyboard navigation.

- The model badge sits at the right edge of the top bar; it used to float a
  third of the bar away because a `Spacer` and two loose flex children split the
  free space.
- The window title is `LockedIn`, and Linux and Windows enforce the documented
  800×600 minimum size.
- Chat usage appears once, in the status bar. The composer no longer repeats the
  same `tok · cost` line 20 px above it.
- Chill's unconfigured state says "no model" once as a state and once as a
  `connect a model` action, instead of four warnings; the `TRY` rows' return
  glyph is readable instead of hairline-on-background.
- The Knowledge page has visible `notes` / `graph` tabs, so the learning graph
  is mouse-reachable, and its header hint names `g`.
- Status-bar hints match the keys the deck really handles (`Tab flip · 1-4
  answer · h/l move · a/f/g/e grade`) and name the teaching loop's keys.
- Settings no longer consumes `Space`; `Enter` runs its rows, so the leader
  works everywhere.

### Changed

- A learner can choose an unlocked branch in the learning tree: `teach.step`
  accepts a `stepId`, refuses a locked step by naming what blocks it, and a held
  step opens no model call. The tree rows are clickable and the next step stays
  the default.
- The teaching page has a keyboard path: `1`–`4` jump phases, `m` measures,
  `n` advances the tree, `i` focuses the answer, `s` opens the side question,
  and `Enter` submits a check. The phase rail's summaries now come from the
  teaching record, and `2 plan` lands on the learning tree even for a course.
- The teaching plan is now a **learning tree**. The first step is open, a branch
  stays locked until every step it builds on is held, and a locked row names
  what still blocks it (`after …`) as well as saying `locked`. Passing a
  prerequisite unlocks the branch immediately.

### Added

- Dart model decoders are generated from the core's TypeScript wire types: the
  Knowledge search/tree models, the full Stats + learning-graph surface, the
  settings view, the session figure, the whole chat cluster including
  `ChatSnapshot`, the work agent profile, the session source, its steps/memory
  projections, the whole session detail, the work project detail, its list rows
  and the agent template row (29 models), with nested models, model arrays,
  `Record` maps
  (of scalars and of models), optional/`null` fields, nullable and recursive
  nested models, flattened object unions (a field whose members disagree on its
  type becomes `Object?` and keeps the raw value) and an omit list for the
  stream counter, with the same tolerant parsing as before. Adding a model is a
  one-line allowlist entry; a stale generated file fails the check.

- Wire method names in the Flutter client are generated from the core's
  capability list (`CoreMethod`), so a renamed method is a compile error rather
  than a runtime `-32601`; a unit test fails if the generated file is stale.

- The packaged desktop bundle has a startup gate: `scripts/desktop-perf.sh`
  measures cold first paint under Xvfb against a 2000 ms budget, CI runs it
  after the release build, and a unit test keeps the doc row and the fixture
  equal.

- A hung `session.create` now has a way out: the wizard gives the call a 60 s
  deadline and a per-attempt idempotency key, so a Retry joins the first create
  (never a second session) and a late session appears in Sessions.

- Numeric columns (the status bar's tokens/cost, Stats' KPI figures and model
  rows, a session row's date and counts) use tabular figures, so they line up
  while they change. The chat status bar no longer repeats the composer's
  send/newline keys; it keeps the global leader chord.

- Layout thresholds live in one `Breakpoints` scale (rail, reading column,
  data column, two-column split, trailing column, search snippet, hint, stacked
  label). Every page compares against a named concept, and a source guard fails
  if a width is compared against a bare number again.

- Every list manager (sessions, skills, review, archive, knowledge, work,
  achievements) shares the detail views' content column, so a wide window no
  longer stretches a row's sentence and its trailing control to opposite edges.
  One `ContentColumn` widget, geometry-tested at 1400×900 and 800×600.

- Raw exception text no longer reaches the UI: the Stats save error and the
  agent Templates hint use the shared `userMessage` mapper, so a stack trace or
  a multi-line payload becomes one readable sentence.

- A promoted mistake can be corrected later: the Mistakes card writes (or
  replaces) the corrected-understanding section, keeps the provenance and
  settles the note, so the graduation path is no longer one-way.

- Swarm reports carry task ids (`task-1`), so a done-but-unverified task stays
  in Review after a core restart and can be verified from the report alone. Old
  reports without ids are read by position and verified in place.

- Review now includes promoted mistakes with no correction yet and Work tasks
  that are done but unverified. `k` marks a mistake reviewed or verifies a task;
  `m` records a mistake miss and is refused for a task; the `work` side joins
  `all`, `school` and `skills`.

- Mistakes can be recorded in a session and **promoted** into a labelled
  school knowledge note with provenance (session, entry, step, open/corrected);
  the note is searchable through Knowledge and is never a source.

- Chat state frames and snapshots carry a per-stream `seq`; the shell drops a
  stale frame instead of overwriting a newer transcript (reconnect and
  coalesced-flush safety).

- Work swarm tasks distinguish **done** from **verified**: a person can verify
  a completed task, the run report is rewritten and the decision is recorded in
  the activity log.

- Work swarms accept task dependencies (`requires`): a task starts only when
  its prerequisites finish, a failed prerequisite blocks its dependents, and the
  board shows what each task waited for.

### Added

- The desktop app: a Flutter shell (`desktop/`) over the same Bun core, talking
  to it over stdio JSON-RPC (`src/server/`). Chat, Stats, Sessions, Sources,
  Skills, Work, Review, Archive, Knowledge and Settings read and write the same
  data with the same rules as the terminal UI, and the workspace, keys and
  providers stay in the core.
- A Windows installer: `scripts/desktop-installer.ps1` builds a per-user NSIS
  setup that needs no administrator rights, writes a Start-menu shortcut and an
  uninstaller, and leaves the workspace and app data alone when it is removed.
  It is unsigned for now, so SmartScreen warns on first run.
- A skill goal can start a second chat (`Shift+N` or `New chat`), instead of
  only resuming the newest transcript.
- The desktop sidebar lists the three most recent sessions under `RECENT`.

- `brailleChart()` draws bars and filled areas on a 2×4 dot grid, with solid
  cells and only the edge dotted. Stats uses it for daily activity and the
  token trend, and plugins can place the same element.
- `button()` draws a tone-filled keycap and fitted label; the MCP permission
  gate uses a button pair for run/refuse.
- `meter()` draws a labelled progress track, and `sparkline()` /
  `sparklineText()` turn a series into block glyphs. The KPI scaffold uses
  both, and the SDK reference documents them.
- `menuList()` draws titled shortcut menus with fitted labels and meta; the
  leader popup renders its registry rows with it.
- `histogram()` counts values into equal-width bins and draws block columns;
  Usage shows a RUN SIZE chart on wide pages.
- `treemap()` draws weighted tiles with fitted labels and percentages; Stats
  shows its by-model block as a treemap on tall pages.
- `definitionList()` draws a shared term column with wrapped descriptions;
  Usage renders its totals with it.
- `statusTimeline()` draws a vertical state rail with connectors and a detail
  row; Usage renders its run history with it.
- `bulletChart()` draws a value fill with a target marker; the Usage spend meter
  marks its warn threshold with it.
- `donut()` draws a multi-segment braille ring with a fitted legend; Usage shows
  model shares as a donut above its bars.
- `progressRing()` draws a braille progress annulus; Stats shows active days as
  a ring beside its counters.
- `sparkbar()` draws compact whole-cell columns from a series; Stats shows
  weekly token totals under its heatmap.
- `dataTable()` fits columns, draws a header rule and supports row selection;
  the MCP tool list uses it.
- `popover()` draws a bordered title/body/menu box with tooltip-style placement;
  tall Settings pages show their hint as a popover.
- `tagCloud()` wraps tags with an overflow count; the Knowledge reader shows the
  open note's tags.
- `numberStepper()` draws an inline minus/value/plus control; Settings Budget is
  steppable with `-`/`+`.
- `thresholdBar()` draws a marked threshold scale; Appearance shows username
  contrast against AA/AAA ticks.
- `rangeSlider()` draws a two-handle track with a filled span and label;
  Settings shows Warn at as a range to the limit.
- `matrix()` draws a fitted labelled grid; the MCP policy matrix uses the same
  layout with muted locked rows.
- `statCard()` draws a fitted value/label/detail card; Stats counters use it and
  add detail lines on tall pages.
- `countBadge()` draws a padded numeric pill with a 99+ overflow; Explorer rows
  show session and project counts.
- `splitButton()` pairs a primary and secondary action with fitted keycaps; the
  chat composer shows send and the newline alternative together.
- `statusBanner()` draws a filled one-line status with a tone glyph and action
  slot; Sources shows blocked and failed states with it.
- `wizard()` draws numbered steps with done/current/upcoming markers; the
  Sources picker shows its Choose/Review flow.
- `multiSelect()` draws a checked list with a cursor, fitted labels and a
  viewport; the Sources picker uses it for its file list.
- `textField()` draws a single-line input with a caret, suffix and invalid tone;
  the Sources search line uses the same field.
- `combobox()` filters and fits suggestion lists with a selected row; the
  command palette shares its ranking and layout.
- `tagInput()` draws bracketed tags with a cursor, validation tones and an
  input tail; Settings shows configured MCP servers as tags.
- `lineChart()` draws a scaled, linked series with fitted y-axis labels; the
  Stats hero plots daily tokens above the week comparison.
- `avatarGroup()` stacks monograms with an overlap and overflow count; the
  agent sidebar header shows the project's agents.
- `delta()` draws a signed percentage with direction glyphs and semantic tone;
  the Stats hero compares the latest seven days with the prior seven.
- `outline()` draws a one-row contents with depth and current markers for plugin
  scenes; the Knowledge reader builds one from note headings.
- `divider()` draws a rule with an optional centred label for plugin scenes;
  the reader renders Markdown rules through the same layout.
- `spinner()` draws a clock-driven frame with a fitted label for plugin scenes;
  plugin discovery ticks the same line while it loads.
- `progressChip()` draws a mini bar and done/total count for plugin scenes;
  Recent shows session and skill progress beside each label.
- `toasts()` draws tone-coded message banners for plugin scenes; the host
  notice surface shares the same tone and fitting layout.
- `rating()` draws filled and empty level pips for plugin scenes; achievement
  detail shows the difficulty tier as pips.
- `segmented()` draws exclusive option groups for plugin scenes; Settings
  renders Period as a day/month control.
- `avatar()` draws monogram badges for plugin scenes; agent roster rows show
  tone-coloured initials.
- `statusDot()` draws health glyphs and labels for plugin scenes; MCP server
  rows show a status dot.
- `swatches()` draws solid colour cells for plugin scenes; the theme picker
  shows four palette tokens per row.
- `codeBlock()` draws numbered code with a fitted content column for plugin
  scenes; the reader's fenced Markdown blocks use the same gutters.
- `pagination()` draws page dots, numbers or a count for plugin scenes; the
  paged help overlay shows dots under its group title.
- `actionBar()` draws grouped keycaps and labels for plugin scenes; the chat
  composer footer uses the same bar.
- `scrollbar()` draws a proportional track and thumb for plugin scenes; the
  Knowledge reader shows one beside long notes.
- `slider()` draws a ranged track with a knob and fitted value label for plugin
  scenes; Settings renders Warn at as a percentage slider.
- `chips()` draws bracketed, removable tokens for plugin scenes; chat
  attachments render as chips with the last one highlighted.
- `toggle()` draws a state pill for plugin scenes; Settings renders Pause at
  limit as a yes/no switch.
- `calendar()` draws a month grid with activity and today marks for plugin
  scenes; Recent shows a calendar of session dates.
- `kanban()` draws counted status columns with selectable cards for plugin
  scenes; the wide Work swarm board groups lanes into ACTIVE/DONE/STOPPED.
- `keycaps()` draws chords as filled caps for plugin scenes; the keybind editor
  styles its binding column with the same caps.
- `skeleton()` draws ragged loading placeholders for plugin scenes; the plugin
  manager shows them while discovering plugins.
- `diff()` draws unified diff rows with old/new line-number gutters for plugin
  scenes; the Work change review uses the same rows.
- `distribution()` draws a stacked share bar with a shared legend; the Stats
  `BY MODEL` chart shows the per-model share above the individual bars.
- `radio()` draws a single-select `(•)`/`( )` list for plugin scenes; the theme
  picker marks the applied palette with the same markers.
- `tooltip()` draws a bordered, wrapped help box with target-aware placement for
  plugin scenes; Settings shows the selected row's hint with `v`.
- `legend()` lays out coloured glyphs and labels for plugin scenes; the Stats
  heatmap shows a `less … more` ramp using the same layout.
- `breadcrumbs()` fits and elides a trail for plugin scenes; the top bar uses
  the same layout and brightens the current crumb.
- `checklist()` draws `[x]`/`[ ]`/`[-]` checkbox rows for plugin scenes; the
  plugin manager uses the same boxes for its enable/disable list.
- `accordion()` draws collapsible titled sections for plugin scenes; Settings
  headers fold and unfold with `h`/`l`.
- `gauge()` draws a ring with a clamped level, centre percentage and caption
  for plugin scenes; the steps reader uses the same level for its progress
  gauge.
- `tree()` draws nested rows with guides, branches and carets for plugin
  scenes; the Explorer sidebar uses the same guides.
- `stepper()` draws done/current/pending entries with a rail for plugin scenes;
  the assignment-steps reader uses the same glyphs and rail.
- `heatmap()` draws a five-step intensity contribution grid for plugin scenes;
  the Stats calendar uses the same levels and ramp.
- `emptyState()` draws a centred glyph/title/hint placeholder for plugin
  scenes; the Activity empty views use the same rows.
- `timeline()` draws a vertical time/glyph/label event list for plugin scenes;
  the Activity log uses the same rows with its selection marker.
- `bars()` draws labelled proportional bars for plugin scenes; the Usage and
  Stats pages use the same layout for their per-model token charts.
- `badges()` draws a row of tone-coded status chips for plugin scenes; the
  Models screen uses the same fills for linked, key-rejected and model-count
  badges.
- `callout()` renders a tone-coded, wrapped warning for plugin scenes; the
  Usage and Stats warnings use the same bar and wrapping in the app.
- `tabs()` draws a filled-chip tab strip for plugin scenes, and the Stats page
  uses it for the range and scope selectors.
- The Stats page shows a daily token trend under the total (bucketed to 60
  columns for a long range), and Usage shows spend against the period budget.

### Changed

- Stats is rebuilt as a readable dashboard: a header with the period and
  filters, a five-figure band, activity and the token trend on the left, and
  models, tools, learning and a recent-days strip on the right. Sections shrink
  to the space available, the page is capped on ultrawide terminals, and an
  empty range invites work instead of showing zeroes.
- The command palette completes with `Tab`: it fills the line with the selected
  command, and Enter no longer runs the first suggestion for a partial line —
  it names the nearest command and leaves the bar open.
- The status bar names the open surface (STATS, SETTINGS, EXPLORER) and shows
  chat hints and notes only while the chat itself is focused; the modal backdrop
  dims the chat more strongly.
- Stats sections carry day/model counts, the page is vertically balanced, and
  the token chart uses the wider area; short line-chart series stretch across
  the plot instead of hugging the left edge.
- The Stats page is grouped into hero, ACTIVITY, TOKENS OVER TIME, BY MODEL and
  SUMMARY sections; the oversized logo and duplicate trend charts are gone.
- The startup splash uses a sparse scan-lit field and a seal pulse as the lock
  closes.
- Chat send keys moved from the composer footer into the centre of the status
  bar as plain, unhighlighted hints; the composer placeholder is shorter.
- Provider settings rows, session-home coverage and task rows now use the
  shared list and status elements; `ListRow` badges can sit beside a value and
  status dots accept custom glyphs and tones.
- Stats and Usage cache their heatmap, chart series and model shares, so
  repainting and resizing no longer rebuild the same derived data; large
  histograms use single-pass range/count scans instead of argument spreads.
- The status bar allocates by priority: pane and mode chips stay whole, the
  warning note is kept before a plugin chip, usage drops before the help hint,
  and the hint shortens on narrow panes instead of clipping mid-word.
- Overlays fade their dimmed backdrop in over 160 ms while the window stays
  opaque; reduced motion skips the fade.
- The blocked-send warning names the problem in a fitted line, splitting the
  fix onto a second row on narrow terminals instead of running off the edge.
- Notices ease in over 180 ms instead of popping into place.
- The status bar shows a warning-toned `no model` chip when the chat has no
  model; `read-only` appears only when a model is configured.
- Host confirms render selectable options (`j/k`, `y/n`, Enter, Esc); menus
  accept `1-9`.
- Plugin status chips are keyed by plugin, show the newest, clear individually
  with `status(null)`, and clear when plugins reload.
- Notices now use the chat bubble caps: a filled, rounded pill with the level
  glyph and message inside. Errors use the error fill, warnings the warning
  fill, and info the panel fill. The fade repaints at 20 Hz and blends fill and
  ink toward the background instead of applying a parent opacity, so the image
  caps and cell body stay on the same shape. The cap cache is bounded.
- Settings now separates **MCP servers** from **UI plugins**, and the plugin
  manager is labelled **UI plugins**. The underlying MCP modules are named
  `src/mcp` / `features/mcp` instead of `plugins`.
- The UI plugin runtime moved to `src/ui/plugins`; `PluginManifest`,
  `SandboxedPlugin` and `SandboxWorkerPlugin` are the primary names.
  `EffectManifest`, `SandboxedEffect` and `SandboxWorkerEffect` remain as
  deprecated aliases for the released SDK.
- Config version 2 migrates `[ui.effects]` to `[ui.plugins]` and removes the
  old table; existing directory/disabled values are preserved.
- `LOCKEDIN_PLUGINS*` and `LOCKEDIN_PLUGIN` are the supported environment
  names; the old `LOCKEDIN_EFFECTS*` names are retired.

### Fixed

- Stats ranges of six weeks or less now read as a dated Mon–Sun week table
  instead of a tiny contribution grid without dates, so a handful of active
  days still makes sense.
- `:keys` and `:keybinds` open the all-keys help overlay instead of a screen
  that was never rendered; a command that refuses now dismisses the palette
  before showing its warning.
- Swarms and Agents say when no project or swarm is open instead of offering
  keys that do nothing, and naming a swarm without a project no longer
  discards the name.
- Agent settings counts `1 agent`, and the Settings Data folder row says it is
  set at launch instead of pointing at a screen that does not exist.
- The instructions file picker no longer calls its file a source, and an empty
  UI plugin manager says where plugins come from and hides `Space enable`.
- An empty Knowledge vault now explains itself instead of showing a blank
  canvas, and the MCP server list hides its empty policy table while showing
  `a add`.
- Archive's privacy line uses a readable date; Activity no longer repeats its
  own title in the subtitle; the Models picker fits its empty hint and footer.
- Two-option settings (Period and Pause at limit) toggle directly with Enter,
  keeping their control visible instead of opening adjustment mode.
- Settings values now change only after Enter: arrows or hjkl adjust the open
  value, and `+`/`-` no longer change settings.
- Settings controls now do what they show: Period and Pause toggle with Enter,
  Warn at and the numeric limits step with `-`/`+`, and max tool calls, max
  tokens and history can be edited numerically. Period, warning and pause
  patches update the panel immediately.
- The MCP servers and Archive backend rows open their own screens instead of
  reporting that they are changed elsewhere.
- The new API elements no longer draw past narrow terminals: the matrix, data
  table, definition list, status timeline, menu, outline, timeline, popover and
  number stepper fit or drop columns instead of overflowing.
- A non-finite wizard step falls back to the first step instead of throwing.
- The Stats heatmap legend stays directly under the heatmap, and the Usage
  run-size histogram scales its bucket count to the recorded runs.

### Removed

- The in-app template and example galleries are no longer part of the packaged
  app. Starter layouts stay in `plugin:new` and the shipped examples stay in
  `src/ui/plugins/examples/` as repository tooling.

## 2026.11.12

### Added

- Plugin commands can choose the host notice level (`notice("saved", "warn")`)
  without writing any bubble, fade or timing code.
- `card({ title, lines, footer, tone })` builds a message window and computes
  its own height, so scene messages do not hand-write layout.
- `transition(elapsed, { enter, hold, exit })` gives a full visibility
  envelope for a card or detail panel.
- Scene permissions may omit `anchors`, `maxNodes` and `maxText`; they default
  to `top-left`, 24 nodes and 512 characters.
- `permissions.commands` accepts bare ids and derives a title.
- `createCursor()` handles clamped/wrapped list and table selection.
- `fields()` builds aligned label/value rows with truncation and a selection bar.
- `log()` tails and truncates a text stream; `stats()` builds right-aligned
  metric rows; `form()` combines fields, a footer and an automatic height.
- Commands can return `confirm()`, `prompt()` or `menu()` to use host-owned
  confirmations, input and pickers; the follow-up command receives `ctx.input`.
- `status()` publishes a status-bar chip and `status(null)` clears it.
- Notices accept a per-message lifetime in seconds; `ctrl+.` dismisses the
  newest bubble.
- `bun run api:reference` generates the SDK reference page; the committed page
  is checked against `sdk/index.ts`.
- Scaffold templates use the cursor helper instead of hand-written clamps, and
  a new `form` template demonstrates fields, footer actions and notices.
- `card()` can be focusable and carry an id, so it replaces detail windows.
- Sandboxed TypeScript plugins with validated manifests, QuickJS workers,
  resource limits, quarantine and the typed `@lockedin/sdk`.
- Particle systems with spawn/step/style hooks, text layers and event bursts.
- Scene API for text, boxes, rules, shapes, lines, paths, arcs, progress and
  sub-cell raster drawing.
- Windows with header/body/footer slots and scrolling; lists; multi-column
  tables with a cell cursor and drag-selection ranges; dashboards, sidebar/main
  and KPI-strip layouts.
- Plugin frame rates, seconds-based animation time, easing, rotation, colour
  fades and palette roles.
- Keyboard commands, focus cycling, pointer clicks/hover/wheel/drag and
  manifest-granted clipboard actions.
- `plugin:build`, `plugin:new` scaffolds, in-app template and example galleries,
  and the `bun run acceptance` pass.

### Changed

- Releases use UTC date versions; `main` is the integration branch and every
  change lands through a pull request.

### Fixed

- The draft-release job resolves the version without requiring Bun.
- Release artifacts no longer embed an example home path.

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

### Added

- `meter()` draws a labelled progress track, and `sparkline()` /
  `sparklineText()` turn a series into block glyphs. The KPI scaffold uses
  both, and the SDK reference documents them.
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

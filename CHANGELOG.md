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

### Removed

- The in-app template and example galleries are no longer part of the packaged
  app. Starter layouts stay in `plugin:new` and the shipped examples stay in
  `src/ui/effects/examples/` as repository tooling.

## 2026.11.12

### Added

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

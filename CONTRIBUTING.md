# Contributing

LockedIn is a keyboard-first **desktop** workspace. The shell is Flutter (Dart)
and the engine is Bun + TypeScript. They talk over newline-delimited JSON-RPC on
stdio. The terminal frontend has been removed; do not reintroduce OpenTUI or
`src/ui`.

## Documentation

- The [README](README.md) is the product and build overview.
- The [Wiki](https://github.com/Jacob-Chamney/LockedIn-Tui/wiki) is the user
  guide: install, keyboard, providers, workspace, plugins and FAQ.
- `desktop/docs/protocol.md` is the wire contract. A protocol change updates it
  and its drift test in the same pull request.

Keep one authoritative description. If the product changes, update the README,
the Wiki and `desktop/docs/` together rather than leaving a second, stale story.

## Before you start

- Open an issue for behaviour changes or large features.
- Keep the change focused. One concern per pull request.
- Do not include secrets, credentials, personal workspaces or machine-specific
  paths in code, tests, fixtures or screenshots.

## Workflow

1. Create a branch from `main`.
   - If you have write access, branch in this repository.
   - Otherwise fork the repository and branch in your fork.
2. Make the change and add or update tests.
3. Run the gates:

   ```sh
   bun install --frozen-lockfile
   scripts/desktop-check.sh     # format, analyze, Flutter tests, core tests
   bun run check                # bounds, typecheck, core tests
   ```

4. Commit with a sign-off:

   ```sh
   git commit -s -m "area: short description"
   ```

The sign-off certifies the Developer Certificate of Origin:
<https://developercertificate.org/>.

5. Open a pull request against `main`. Describe the behaviour change, the tests
   and any user-visible impact. Do not push directly to `main`; the branch is
   protected and the gate must pass before merge.

**Every change to `main` lands through a pull request**, including maintainer
and automation changes. Protection requires the check and desktop jobs on Linux
and Windows, so a local pass is not a substitute for CI.

`main` is the integration branch. A merged contribution is not a release; it is
included in the next UTC-dated release. Releases are tags cut from `main`
(`2026.11.12`), not separate branches. There is no `next` or release branch to
target.

## Architecture rules

- `src/domain` imports nothing outside itself.
- `src/services`, `src/storage`, `src/stats`, `src/llm`, `src/mcp`,
  `src/security` and `src/archive` never import `src/app` or `desktop/`.
- `src/server` is an adapter: JSON-RPC, boot, command/event mapping. It must not
  import `desktop/` or a UI.
- `desktop/` owns layout, focus and transient dialogs. It does not read files,
  hold secrets or re-derive totals.
- Provider keys live only in the OS keychain.
- Writes are explicit, path-confined and atomic. A failed or rejected write
  leaves the previous bytes in place.
- `scripts/check-bounds.ts` enforces the import direction; a cycle or an upward
  import fails the gate.

## Code expectations

- TypeScript is strict; Dart is formatted and analyzed.
- A feature includes its failure, cancelled and empty states.
- Tests must fail if the behaviour is removed. No network in unit tests.
- A protocol change adds a contract test and updates
  `desktop/docs/protocol.md`; the capability list is checked against the
  handshake example.
- `desktop/lib/bridge/core_methods.g.dart` is generated from `CAPABILITIES`.
  After adding or renaming a method, run
  `bun run scripts/generate-dart-bindings.ts` and commit the result. The check
  fails if the file is stale or a raw `_connection.call('…')` literal returns.
- A UI change that alters a screen shown in the README or Wiki updates the
  matching image or description in the same pull request.

## Changelog and credit

The public [CHANGELOG.md](CHANGELOG.md) and the wiki **Releases** page are built
from merged pull requests. One PR should normally produce one entry.

- Use a clear, user-facing PR title; it becomes the changelog line.
- Add or extend the `Unreleased` section of `CHANGELOG.md` for any user-visible
  behaviour, including fixes and breaking changes.
- Preserve authorship. Squash or rebase merges keep the PR author as the commit
  author; add `Co-authored-by: Name <email>` trailers for paired work. Do not
  rewrite or drop another contributor's attribution.
- Name contributors in the release notes when a PR is largely theirs.

## Licence

By contributing, you agree that your contribution is licensed under
AGPL-3.0-only. The project does not use a CLA.

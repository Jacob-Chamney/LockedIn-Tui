# Contributing

LockedIn-Tui is a keyboard-first workspace built with Bun, TypeScript,
Solid and OpenTUI.

## Documentation

User documentation lives in the [Wiki](https://github.com/Jacob-Chamney/LockedIn-Tui/wiki).
Keep install, keyboard and provider guidance there; the repository README stays
focused on building and running the source.

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
3. Run the full gate:

   ```sh
   bun install --frozen-lockfile
   bun run check
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

`main` is the integration branch. A merged contribution is not a release; it is
included in the next UTC-dated release. Releases are tags cut from `main`
(`2026.11.12`), not separate branches. There is no `next` or release branch to
target.

## Code expectations

- TypeScript is strict. Domain and service modules never import UI or app code.
- New UI components compose the shared panels, lists and windows rather than
  copying their chrome.
- A feature includes its failure, cancelled and empty states.
- Tests must fail if the behaviour is removed. No network in unit tests.
- When a UI change alters a screen shown in the README, refresh the matching
  image in `assets/screenshots/` in the same pull request.

## Licence

By contributing, you agree that your contribution is licensed under
AGPL-3.0-only. The project does not use a CLA.

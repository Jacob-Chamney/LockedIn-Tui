# Running the desktop app

The desktop app is a Flutter shell over the same Bun core the terminal UI uses.
The shell never reads the workspace, the config or a key: it starts
`lockedin-core` as a sidecar and talks to it over stdio JSON-RPC
(`docs/protocol.md`). Everything below is about getting a build running, not
about how it works.

## Requirements

| Need | Why |
|---|---|
| Linux with GTK 3, or Windows 10/11 | The shell is Flutter desktop |
| `bun` 1.4.4 | Builds the sidecar and runs the core gate |
| Flutter 3.50 stable | Builds the shell (`$FLUTTER_HOME`, or on `PATH`) |
| `libgtk-3-dev`, `libblkid-dev`, `liblzma-dev` | Linux build only |

`scripts/desktop-env.sh` puts a local SDK on `PATH` when one is installed under
`$FLUTTER_HOME` (default `~/.local/share/flutter`).

## From source

```sh
bun install --frozen-lockfile
scripts/desktop-dev.sh        # builds the core, then `flutter run -d linux`
```

`desktop-dev.sh` runs the sidecar with `bun run src/server/main.ts`, so a change
to the core is picked up on the next shell restart — no rebuild of the sidecar
and no second process to manage by hand.

## A packaged build

```sh
scripts/desktop-build.sh linux       # shell + compiled core in desktop/build/.../bundle
scripts/desktop-package.sh --no-build # dist/lockedin-desktop-linux-x64.tar.gz
```

Windows builds the same way (`scripts/desktop-build.sh windows`,
`scripts/desktop-package.ps1`, `scripts/desktop-installer.ps1`). The bundle and
the setup both contain the compiled core and the native keychain addon; a
recipient needs no Bun and no Flutter.

Run the extracted Linux tarball with its own entry point:

```sh
tar -xzf dist/lockedin-desktop-linux-x64.tar.gz -C ~/lockedin-desktop
~/lockedin-desktop/lockedin_desktop
```

## First run

Nothing needs to be prepared. On launch:

1. The core creates the workspace (`~/LockedIn` by default) with
   `workspace.json`, `config.toml`, `school/`, `skills/`, `work/` and `input/`.
   A folder that already exists **and is empty** is used the same way; a folder
   that holds anything else is refused rather than adopted.
2. The app opens on **Chill** with `no model connected`.
3. A model is linked in **Settings → Providers**: paste a key, the core checks
   its shape, makes one authenticated request, and stores it in the OS keychain
   only after that succeeds. Linking does not pick a model — choose one in
   **Settings → Models**.

Useful environment variables (all optional, read by the core):

| Variable | Effect |
|---|---|
| `LOCKEDIN_WORKSPACE` | use this folder as the workspace (created if empty) |
| `LOCKEDIN_DATA_DIR` | put app data (usage, stats, logs, Chill history) here |
| `LOCKEDIN_KEYRING_ADDON` | point at a bundled `@napi-rs/keyring` entry file |
| `LOCKEDIN_RENDERER=opengl` | opt out of the NVIDIA software-renderer fallback |

A machine with the v0.7 app installed has a `~/LockedIn` that this build must
not touch. In that case it says so and uses `~/LockedIn-Tui` instead.

## Smoke test a build

```sh
scripts/desktop-smoke.sh                 # the local release bundle
scripts/desktop-smoke.sh --bundle=/path/to/extracted-tarball --keep
```

It launches the app on a virtual display against throwaway state and fails
unless the window appears, the first frame has real content, the core writes
`workspace.json` into an empty folder, and the sidecar is still running. It
never touches your workspace, `HOME`, display or keychain. With `--keep` it
leaves the frame at `$TMPDIR/lockedin-smoke/smoke.png` for inspection.

## What to look at while testing

- **Chill** — send a message, watch it stream, `Esc` to stop. `:clear` empties
  the transcript. Paste an image to ask about it.
- **Sessions** — `n` starts a lock-in: pick sources, add instructions, review.
  The steps reader's `Space` toggles one checkbox and rewrites only that line.
- **Skills** — `n` creates a goal; `c` opens its newest chat; `Shift+N` starts a
  second one.
- **Work** — `n` registers an existing folder. Writes and commands are off until
  they are switched on in Settings **and** the agent profile allows them; every
  write or command still needs its own approval.
- **Settings** — providers, models, budget, storage, archive, plugins, themes,
  keybinds, appearance. Every change applies immediately.
- **Stats, Review, Archive, Knowledge** — read-only surfaces over the same data.

`Alt+1…9` switches surfaces, `Alt+0` Settings, `Ctrl+K` opens the command
palette, `Esc` leaves a dialog.

## What is not done

Unsigned builds: Authenticode signing needs a certificate, so Windows shows a
SmartScreen warning. MSIX packaging is not started. A clean-machine install on a
fresh VM has not been verified; the installer's install/uninstall path is
exercised in CI.

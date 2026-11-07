# Installing LockedIn-Tui 1.3.2

LockedIn-Tui ships as one compiled binary per platform. Bun, SQLite/FTS5 and
the terminal renderer are inside the file; there is no runtime, no installer and
no `node_modules`. The binary uses the system C library; Alpine also needs the
standard `libstdc++` package.

## 1. Pick your target

| Platform | Artifact | Status |
|---|---|---|
| Linux x64 (glibc) | `lockedin-1.3.2-bun-linux-x64` | verified in CI |
| Linux x64 (musl / Alpine) | `lockedin-1.3.2-bun-linux-x64-musl` | verified in Alpine |
| Linux arm64 (glibc) | `lockedin-1.3.2-bun-linux-arm64` | verified in CI |
| Linux arm64 (musl) | `lockedin-1.3.2-bun-linux-arm64-musl` | verified in Alpine |
| macOS arm64 | `lockedin-1.3.2-bun-darwin-arm64` | verified in CI |
| macOS x64 | `lockedin-1.3.2-bun-darwin-x64` | verified in CI |
| Windows x64 | `lockedin-1.3.2-bun-windows-x64.exe` | verified in CI (ConPTY) |

The 1.0 binaries are **not code-signed**. Verify the checksum before running
them. macOS may quarantine a browser download; Windows SmartScreen may show
"Windows protected your PC". Both steps are in
[§8 Troubleshooting](#8-troubleshooting).

"Verified" means the release workflow launched the binary and painted the first
screen on native hardware, or inside an Alpine container on the matching
architecture for musl.

Check your machine:

```bash
uname -s   # Linux | Darwin
uname -m   # x86_64 | arm64
```

Alpine and other musl systems need the `-musl` artifact and the standard C++
runtime:

```sh
apk add libstdc++
```

On Windows, use the `.exe` file.

## 2. Install

### Quick install

```bash
curl -fsSL https://github.com/Jacob-Chamney/LockedIn-Tui/releases/latest/download/install.sh | sh
```

The installer detects Linux or macOS, x64 or arm64, and glibc or musl. It
verifies the download against `SHA256SUMS` and installs `~/.local/bin/lockedin`.
Use `LOCKEDIN_VERSION=1.0.0` to pin a release and
`LOCKEDIN_INSTALL_DIR=/usr/local/bin` to choose a directory. It never uses
`sudo` and never edits a shell profile.

To inspect the script before running it:

```bash
curl -fsSLO https://github.com/Jacob-Chamney/LockedIn-Tui/releases/latest/download/install.sh
less install.sh
sh install.sh
```

### Manual download and verify

#### Linux

```bash
VERSION=1.3.2
BASE="https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v$VERSION"
ARTIFACT="lockedin-$VERSION-bun-linux-x64"   # replace with your target

curl -fsSL -o "$ARTIFACT" "$BASE/$ARTIFACT"
curl -fsSL -O "$BASE/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS
chmod +x "$ARTIFACT"
mkdir -p ~/.local/bin
install -m 0755 "$ARTIFACT" ~/.local/bin/lockedin
```

If `~/.local/bin` is not on `PATH`, add it to your shell profile. On macOS, add
`export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc`. On Alpine use
`sha256sum -c SHA256SUMS` after downloading only that artifact, or install
`coreutils`.

#### macOS

```bash
VERSION=1.3.2
BASE="https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v$VERSION"
ARTIFACT="lockedin-$VERSION-bun-darwin-arm64"   # or -darwin-x64

curl -fsSL -o "$ARTIFACT" "$BASE/$ARTIFACT"
curl -fsSL -O "$BASE/SHA256SUMS"
grep "$ARTIFACT" SHA256SUMS | shasum -a 256 -c -
chmod +x "$ARTIFACT"
mkdir -p ~/.local/bin
install -m 0755 "$ARTIFACT" ~/.local/bin/lockedin
```

`shasum -c -` reads the checksum line from standard input, so the file name in
`SHA256SUMS` must match the downloaded name.

#### Windows

```powershell
$VERSION = "1.3.2"
$BASE = "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v$VERSION"
Invoke-WebRequest "$BASE/lockedin-$VERSION-bun-windows-x64.exe" -OutFile lockedin.exe
Invoke-WebRequest "$BASE/SHA256SUMS" -OutFile SHA256SUMS

$expected = (Select-String -Path SHA256SUMS -Pattern "lockedin-$VERSION-bun-windows-x64.exe").Line.Split()[0]
$actual = (Get-FileHash .\lockedin.exe -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw "checksum mismatch" }

New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Programs\LockedIn" | Out-Null
Move-Item -Force .\lockedin.exe "$env:LOCALAPPDATA\Programs\LockedIn\lockedin.exe"
```

Add `%LOCALAPPDATA%\Programs\LockedIn` to your user `PATH` and open a new
terminal. No administrator rights are needed.

## 3. First run

```bash
lockedin --version
lockedin
```

The first run creates a workspace at `~/LockedIn` (or `$LOCKEDIN_WORKSPACE`),
or at the path you pass:

```bash
lockedin --workspace ~/Study
```

If `~/LockedIn` is a workspace from the older Python version, LockedIn refuses
to modify it, explains why, and uses `~/LockedIn-Tui` instead. Pass
`--workspace` to choose another folder.

Inside the app, `Ctrl+Q` quits, `?` opens the help overlay, and the leader key
opens the pane list. Providers are linked from Settings; keys are written to
the OS keychain, not to config.

## 4. Requirements

- A truecolor terminal: Ghostty, Kitty, WezTerm, Windows Terminal, iTerm2, or a
  plain `xterm-256color` fallback.
- At least 80×24 cells; 120×36 or larger is comfortable.
- An OS keychain: Secret Service (GNOME Keyring / KWallet) on Linux, Keychain
  on macOS, Credential Manager on Windows.

The app runs without a keychain, but it cannot store provider or archive
secrets until one is available. It never falls back to a config file.

## 5. Updates

LockedIn checks the public release feed once per launch. A newer release shows
as `↑ <version> · :update` in the top bar.

```text
:update
```

The command:

- downloads the artifact for this platform and architecture;
- verifies it against the release's `SHA256SUMS`;
- replaces the installed binary (`rename` is atomic on Linux and macOS; Windows
  renames the running image aside and removes it on the next launch);
- asks you to quit and reopen.

Updates are user-triggered. There is no automatic install, background service or
retry. The only automatic background request is the once-per-launch release check; it sends
no workspace data. Source builds do not check or update; use the release binary. If the install
directory is not writable, the error names the asset and the release page so you
can install it manually with the commands above.

## 6. Upgrade

Replace the binary; nothing else changes.

```bash
VERSION=1.3.2
BASE="https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v$VERSION"
ARTIFACT="lockedin-$VERSION-bun-linux-x64"

curl -fsSL -o "$ARTIFACT" "$BASE/$ARTIFACT"
curl -fsSL -O "$BASE/SHA256SUMS"
sha256sum -c --ignore-missing SHA256SUMS
chmod +x "$ARTIFACT"
mv "$ARTIFACT" "$(command -v lockedin)"
```

- The workspace (default `~/LockedIn`, or your `--workspace` path) and the data
  directory are untouched.
- No migration runs unless the on-disk schema version changed.
- Keep the previous binary if you want a one-command rollback.

## 7. Uninstall

```bash
rm "$(command -v lockedin)"
```

What stays behind, deliberately:

| Path | What it is | Remove it with |
|---|---|---|
| `~/LockedIn/` (or your `--workspace` path) | notes, sessions, outputs, projects | `rm -rf ~/LockedIn` after checking for notes you want |
| `~/.local/share/lockedin/` | Chill history, usage, stats, activity log | `rm -rf ~/.local/share/lockedin` |
| OS keychain entries | provider and archive tokens | your keychain UI, or `secret-tool clear service lockedin` |
| `~/.cache/lockedin/` (if present) | rebuildable index cache | `rm -rf ~/.cache/lockedin` |

Deleting the binary never deletes a workspace, and deleting a workspace never
touches the keychain.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `binary exits immediately` under cron or CI | no TTY | run inside a terminal or a pty |
| `error: preload not found "@opentui/solid/preload"` | the current directory has a `bunfig.toml` whose preload the binary inherits | run the binary from another directory, or remove the preload |
| Blank or garbled screen | terminal is not truecolor or the window is too small | use a truecolor terminal and at least 80×24 |
| `keychain unavailable` | no Secret Service on Linux | start GNOME Keyring or KWallet, or use a desktop session with one |
| Checksum mismatch | download was truncated or the wrong artifact | download again and compare the full file name |
| macOS says the app is from an unidentified developer | unsigned binary | `xattr -d com.apple.quarantine ./lockedin` after verifying the checksum |
| Windows says "Windows protected your PC" | unsigned binary with no SmartScreen reputation | verify `SHA256SUMS`, then **More info → Run anyway**; do not bypass without checking the hash |

The app writes no telemetry. Logs are local and redact secrets.

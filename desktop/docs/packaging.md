# Desktop packaging

Status: **Linux tarball** (`scripts/desktop-package.sh`) and **Windows zip**
(`scripts/desktop-package.ps1`) are implemented. Windows signing, NSIS/MSIX
installers and an install/uninstall pass remain. There is no cross-packaging:
each artifact is built on its own platform.

## Shape

The desktop app is two binaries shipped together:

```
lockedin_desktop                 Flutter shell (ELF)
lockedin-core                    compiled Bun core sidecar (ELF)
lib/libflutter_linux_gtk.so      Flutter GTK embedder
lib/libapp.so                    compiled Dart AOT snapshot
data/…                           Flutter assets, including NOTICES.Z
LICENSE                          application licence (AGPL-3.0-only today)
NOTICE                           artifact inventory
THIRD-PARTY-NOTICES.md           generated Bun/npm notice set
```

The Windows bundle is the same shape with `lockedin_desktop.exe` and
`lockedin-core.exe`; see [Windows](#windows).

The shell resolves `lockedin-core` from its own directory. If the sidecar is
missing it falls back to `bun run`, which fails on a machine without Bun — so
the sidecar is not optional in a distribution.

## Linux procedure

```sh
scripts/desktop-build.sh linux     # writes desktop/build/linux/x64/release/bundle
scripts/desktop-package.sh         # build (if needed) + package
# or, after a build:
scripts/desktop-package.sh --no-build
```

Both paths write `dist/lockedin-desktop-linux-x64.tar.gz`. `dist/` is generated
and never committed. Re-running the script is safe: the staged `LICENSE` is
overwritten and the tarball is replaced.

The script:

1. runs `scripts/desktop-build.sh linux` unless `--no-build` is given;
2. copies the repository `LICENSE` into the bundle root;
3. asserts `lockedin_desktop`, `lockedin-core`, `lib/libflutter_linux_gtk.so`,
   `data/flutter_assets/NOTICES.Z`, `LICENSE`, `NOTICE` and
   `THIRD-PARTY-NOTICES.md` are present, and that the core is executable;
4. writes the tarball with the bundle **contents at the archive root** (no
   `bundle/` prefix);
5. re-opens the tarball and fails with the name of any missing entry;
6. prints the artifact path, human size and byte size.

Exit is non-zero with `missing archive entry: <name>` when a contract entry is
absent, so CI fails on a broken artifact rather than a bad extraction later.

## Verify a tarball

```sh
tar -tzf dist/lockedin-desktop-linux-x64.tar.gz | sort
tar -tzf dist/lockedin-desktop-linux-x64.tar.gz | grep -qxF ./lockedin-core
tar -tzf dist/lockedin-desktop-linux-x64.tar.gz | grep -qxF ./LICENSE
ls -lh dist/lockedin-desktop-linux-x64.tar.gz

# smoke test in a throwaway directory
tmp="$(mktemp -d)"
tar -xzf dist/lockedin-desktop-linux-x64.tar.gz -C "$tmp"
test -x "$tmp/lockedin-core" && echo "core executable"
```

Run the extracted shell on a machine with GTK 3 present. The core uses the OS
keychain; a missing keyring is a typed error, never a plaintext fallback.

## Linux renderer note

The NVIDIA software-renderer fallback is **inside the binary**
(`desktop/linux/runner/my_application.cc`). When `/dev/nvidiactl` exists the
runner selects `FLUTTER_LINUX_RENDERER=software` and disables Impeller before
the engine starts, avoiding the Flutter 3.50.0 OpenGL compositor offset bug on
the proprietary driver. No environment variable or extra file is needed in the
tarball.

- `LOCKEDIN_RENDERER=opengl` opts out (useful once the pinned Flutter is
  3.50.1+).
- An explicit `FLUTTER_LINUX_RENDERER` always wins.
- Remove the fallback when the pinned engine is fixed.

## Windows

`scripts/desktop-build.sh windows` builds on Windows (`flutter build windows`
plus `lockedin-core.exe`) into `desktop/build/windows/x64/runner/Release`. Do
**not** cross-package: the Windows build needs the Windows Flutter toolchain and
a `bun-windows-x64` compile.

### Windows zip procedure

`scripts/desktop-package.ps1` is the Windows counterpart of the tarball script.
PowerShell 7 (`pwsh`) is preferred; Windows PowerShell 5.1 works but its
`Compress-Archive` is much slower:

```powershell
pwsh ./scripts/desktop-package.ps1             # build, then package
pwsh ./scripts/desktop-package.ps1 -NoBuild    # reuse the release build
```

Both paths write `dist/lockedin-desktop-windows-x64.zip`. `dist/` is generated
and never committed, and re-running is safe: the staged `LICENSE`/`NOTICE` files
are overwritten and the zip is replaced.

The script:

1. runs `scripts/desktop-build.sh windows` through `bash` (Git Bash) unless
   `-NoBuild` is given, and fails with a clear message when `bash` is missing;
2. copies the repository `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.md` into
   the bundle root;
3. asserts the bundle carries `lockedin_desktop.exe`, `lockedin-core.exe`,
   `data/flutter_assets/NOTICES.Z`, the three licence/notice files,
   `node_modules/@napi-rs/keyring/index.js` and at least one native
   `*.node` addon under `node_modules/@napi-rs`;
4. writes the zip with `Compress-Archive` and the bundle **contents at the
   archive root** (no `Release/` prefix);
5. re-opens the zip with `System.IO.Compression.ZipFile`, rejects absolute entry
   names, and fails with the name of any missing contract entry;
6. prints the artifact path, size and the keychain addon it staged.

Exit is non-zero for a missing bundle, a missing contract entry, a bundle
without a native keychain addon, or a failed build, so CI fails on a broken
artifact rather than on the user's machine. The staged bundle must contain:

```
lockedin_desktop.exe                     Flutter shell
lockedin-core.exe                        compiled Bun core sidecar
data/flutter_assets/NOTICES.Z            Flutter/Dart and third-party notices
data/…                                   Flutter assets and ICU data
LICENSE                                  application licence (AGPL-3.0-only today)
NOTICE                                   artifact inventory
THIRD-PARTY-NOTICES.md                   generated Bun/npm notice set
node_modules/@napi-rs/keyring/index.js           addon entry (LOCKEDIN_KEYRING_ADDON)
node_modules/@napi-rs/keyring/keyring.win32-x64-msvc.node
node_modules/@napi-rs/keyring-win32-x64-msvc/…   the same binary as a package
```

`Compress-Archive` re-compresses the whole bundle, and the compiled core is
large (the Bun runtime floor alone is ~104 MB), so the zip step takes a few
minutes and uses a noticeable amount of memory; the Windows CI job allows 30
minutes end to end. Windows PowerShell 5.1 additionally caps an archive at
2 GB, which a bundle this size never approaches.

### Keychain addon

`bun build --compile` cannot embed the native N-API addon, so
`scripts/desktop-build.sh windows` copies `@napi-rs/keyring` and
`@napi-rs/keyring-win32-x64-msvc` into the bundle and also copies the `.node`
flat beside the addon entry. The shell's `sidecarEnvironment()` sets
`LOCKEDIN_KEYRING_ADDON` to the `index.js` beside the executable, so the packaged
core reaches the Windows Credential Manager.

Without the addon the zip is not shippable: Windows has no command-shim backend
(the `secret-tool`/`security` fallback is Linux/macOS only), so linking a
provider key returns the typed `unsupported` error instead of storing anything.
The packaging script therefore refuses a bundle with no `*.node`. To build
deliberately without a keychain, set `LOCKEDIN_SKIP_KEYRING=1` — the script then
fails by name, which is the intended outcome for a distributable bundle.

### Verify a zip

```powershell
Expand-Archive dist/lockedin-desktop-windows-x64.zip -DestinationPath .\verify -Force
Test-Path .\verify\lockedin_desktop.exe
Test-Path .\verify\lockedin-core.exe
Test-Path .\verify\data\flutter_assets\NOTICES.Z
Get-ChildItem .\verify\node_modules\@napi-rs\keyring -Filter *.node
(Get-Item dist/lockedin-desktop-windows-x64.zip).Length
```

Then run `lockedin_desktop.exe` from the extracted folder on a Windows machine
with the Visual C++ runtime the Flutter toolchain expects. The core runs from a
neutral working directory and needs `lockedin-core.exe` beside the shell; a zip
without it falls back to `bun run` and fails on a machine without Bun.

### Not shipped yet

- **No signing.** The zip is unsigned, so SmartScreen warns on first run.
- **No installer.** No NSIS or MSIX, so there is no Start Menu entry, file
  association, upgrade path or uninstaller. The zip is a portable archive:
  extract it and keep the folder together.
- **No install/uninstall verification pass.** That test needs the signed
  installer and is a later packet.
- **No auto-update** and no per-user data migration on upgrade.

## Licence and notices policy

- `flutter build` emits `data/flutter_assets/NOTICES.Z` containing the
  Flutter/Dart and third-party notices. It ships inside both the tarball and the
  zip; do not strip it.
- The repository `LICENSE` is copied to the bundle root so the binary
  distribution carries the application licence. `NOTICE` and the generated
  `THIRD-PARTY-NOTICES.md` are copied too; the latter inventories the Flutter
  and Bun/npm notices (including Bun's JavaScriptCore/WebKit notice). Current
  source is AGPL-3.0-only; Flutter/BSD is compatible.
- `LICENSES/` and `NOTICE` list third-party packages and versions when those
  files land. Every new package that ships needs a notice entry.
- No Qt libraries are used, so no Qt LGPL/source-offer obligation applies.
- No secrets, tokens, workspace paths or usage data may appear in the tarball,
  logs or screenshots. See `desktop/docs/licensing.md` for the full policy.

## CI

`.github/workflows/desktop.yml` builds both artifacts. The Linux job runs the
release build with the core sidecar, then:

```sh
./scripts/desktop-package.sh --no-build
ls -lh dist/lockedin-desktop-linux-x64.tar.gz
test -x desktop/build/linux/x64/release/bundle/lockedin-core
```

The Windows job (`windows-2022`) runs the same build script for Windows, then:

```powershell
./scripts/desktop-package.ps1 -NoBuild
# prints: zip size: <n> bytes (<n> MiB)
```

The workflow keeps `permissions: contents: read`; it uploads nothing, deploys
nothing and references no secret. Both artifacts are build results, not
releases; neither is signed.

## Windows CI without hosted minutes

The `windows-2022` job in `desktop.yml` needs paid Actions minutes on a private
repository, and this account has none left — every run, including a one-step
echo probe, fails in ~2 s with zero steps and no runner assigned. Use
`desktop/docs/windows-verification.md` instead:

- `.github/workflows/desktop-selfhosted.yml` runs the identical build on
  `[self-hosted, windows, x64]` and checks the sidecar is a real PE binary that
  answers `initialize`;
- the same doc lists the local-VM, buy-minutes and public-repository options,
  with what can and cannot be verified from Linux.

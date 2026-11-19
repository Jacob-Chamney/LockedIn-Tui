# Verifying Windows without hosted Actions minutes

The GitHub-hosted `windows-2022` runner consumes paid Actions minutes on a
**private** repository. This account has none left, and the failure looks like a
code error if you have not seen it before:

```
runs 44021179591 / 44022190117 / 44022262095
  desktop (windows x64)   completed failure   0 steps   2 s   runner_name: ""
  probe (one-step echo)   completed failure   0 steps   2 s   runner_name: ""
repos/<owner>/<repo>/actions/runners -> {"total_count":0}
```

Zero steps and an empty runner name on **both** Ubuntu and Windows, while
`actions/permissions` reports `enabled: true`, is quota or a spending limit —
never the workflow. A one-step `echo` job that fails identically proves it.

## Options, cheapest first

### 1. A self-hosted runner (free, recommended)

Any Windows machine — a spare PC, a laptop, or a local VM — can run the job.
Self-hosted runners do not consume hosted minutes.

1. Install the toolchain on it: Flutter **3.50** stable, Bun **1.4.4**, Git.
2. GitHub → *Settings → Actions → Runners → New self-hosted runner → Windows*.
3. Run the download/config commands GitHub shows, then install it as a service:

   ```powershell
   .\config.cmd --url https://github.com/<owner>/<repo> --token <TOKEN>
   .\svc.cmd install
   .\svc.cmd start
   ```

   The token comes from that page; it is not stored in this repository.
4. Run the workflow: *Actions → Desktop (self-hosted Windows) → Run workflow*
   (`workflow_dispatch`), or `gh workflow run desktop-selfhosted.yml`.

It builds `lockedin-core.exe` and `lockedin_desktop.exe`, packages the zip,
checks the sidecar is a real PE binary (MZ header) and makes it answer
`initialize`. That is the Windows evidence `docs/testing.md` §9 asks for.

### 2. A local Windows VM with KVM (free, no runner)

This host has `/dev/kvm`. A Windows 11 Enterprise evaluation or a Fedora/Ubuntu
Windows VM can run the same two commands by hand:

```powershell
.\scripts\desktop-build.sh windows   # from Git Bash
.\scripts\desktop-package.ps1
```

Slow to set up (a ~5 GB image), but no billing and no runner registration. Use
it only if a runner is not an option, because the runner is repeatable.

### 3. Buy minutes / raise the spending limit

Billing → Actions → raise the spending limit for private repositories. This is
the smallest effort and the only recurring cost. It also unblocks the Linux
`check` and `perf` jobs, which currently cannot run either.

### 4. Make the source repository public

GitHub gives **unlimited** Actions minutes for public repositories. That is a
product/licensing decision (`AGENTS.md` §"Direction update", `docs/release.md`),
not a build tweak: the public repository today is the binaries-only tree
`Jacob-Chamney/LockedIn-Tui`. Do not flip visibility to save minutes without the
owner's explicit decision.

## What can be verified without any of the above

Cross-compiling the sidecar works from Linux, and the binary is a real PE:

```sh
bun build --compile --target=bun-windows-x64 \
  --define 'process.env.LOCKEDIN_RELEASE="1"' \
  --define 'process.env.LOCKEDIN_APP_VERSION="2026.11.12"' \
  src/server/main.ts --outfile lockedin-core.exe

file lockedin-core.exe
# PE32+ executable for MS Windows 6.00 (console), x86-64, 13 sections
```

Under Wine the compiled sidecar answers `initialize` (protocol 1, 94 methods),
every `ping`, and `shutdown`. It did **not** complete a workspace boot under
Wine in this environment — the handler for the first data method never resolved,
and a piped stdin additionally trips Wine's `EISDIR` on `Bun.stdin.stream()`
(a file redirect works). That is a Wine limitation to confirm, not a proven
Windows bug, and it is exactly the gap a real Windows run closes.

`scripts/desktop-build.sh windows` already bundles the sidecar and the
`keyring-win32-x64-msvc` addon; `scripts/desktop-package.ps1` already refuses a
zip without a `.node`. Both were exercised against a synthetic bundle under
PowerShell 7 on Linux, including their failure paths.

## What is still unproven

- `flutter build windows` (needs Windows + MSVC).
- The Flutter Windows shell launching the bundled sidecar.
- Authenticode signing (needs a code-signing certificate).
- A clean-machine install: CI now builds `scripts/desktop-installer.ps1`, installs
  the setup silently, asserts the installed files and uninstalls it again on the
  runner (`-Verify`), which proves the installer itself; a fresh virtual machine
  is still the only way to prove SmartScreen and the first-run experience.
- The native keychain addon on real Windows (`keyring-win32-x64-msvc`).

None of that can be claimed from Linux, and none of it is a reason to mark
Windows done.

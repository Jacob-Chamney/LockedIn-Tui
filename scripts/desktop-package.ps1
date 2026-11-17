#Requires -Version 5.1
<#
.SYNOPSIS
  Package the Windows desktop release as a distributable zip.

.DESCRIPTION
  The bundle is produced by scripts/desktop-build.sh windows (the Flutter shell
  plus the compiled Bun core sidecar). This script only stages and verifies the
  artifact; it does not build Flutter itself unless asked, so CI can reuse its
  release build.

  Staged and verified:
    lockedin_desktop.exe, lockedin-core.exe, data/flutter_assets/NOTICES.Z,
    LICENSE, NOTICE, THIRD-PARTY-NOTICES.md and the native keychain addon
    (node_modules/@napi-rs/keyring).

  Output: dist/lockedin-desktop-windows-x64.zip
  The archive root is the bundle directory's contents, so a recipient extracts
  the zip and runs lockedin_desktop.exe. Re-running is safe: the staged licence
  files are overwritten and the zip is replaced.

  Signing, NSIS and MSIX are later packets. This script produces an unsigned
  portable archive and nothing else.

.PARAMETER NoBuild
  Reuse desktop/build/windows/x64/runner/Release instead of building.

.EXAMPLE
  pwsh ./scripts/desktop-package.ps1 -NoBuild
#>
[CmdletBinding()]
param(
    [switch]$NoBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Bundle = Join-Path $Root "desktop/build/windows/x64/runner/Release"
$Dist = Join-Path $Root "dist"
$Artifact = Join-Path $Dist "lockedin-desktop-windows-x64.zip"
$BuildScript = Join-Path $Root "scripts/desktop-build.sh"

# The bundle's own addon entry: the shell points the core at this file with
# LOCKEDIN_KEYRING_ADDON (desktop/lib/bridge/core_client.dart).
$KeyringEntry = "node_modules/@napi-rs/keyring/index.js"
$KeyringDir = Join-Path $Bundle "node_modules/@napi-rs/keyring"

# One error = one message and a non-zero exit. Never print a stack trace for an
# expected packaging refusal, and never echo an environment value: nothing here
# needs a secret.
function Write-Failure {
    param([Parameter(Mandatory = $true)][string]$Message)
    [Console]::Error.WriteLine("desktop-package: $Message")
    exit 1
}

if (-not $NoBuild) {
    if (-not (Test-Path -LiteralPath $BuildScript -PathType Leaf)) {
        Write-Failure "missing build script: $BuildScript"
    }
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if ($null -eq $bash) {
        Write-Failure "bash is not on PATH; run scripts/desktop-build.sh windows first (Git Bash is required), then re-run with -NoBuild"
    }
    Write-Host "building: scripts/desktop-build.sh windows"
    & $bash.Source $BuildScript windows
    if ($LASTEXITCODE -ne 0) {
        Write-Failure "scripts/desktop-build.sh windows failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path -LiteralPath $Bundle -PathType Container)) {
    Write-Failure "missing bundle: $Bundle`nrun scripts/desktop-build.sh windows first"
}

# The binary distribution carries the app licence and the notice sets. Copying
# into the bundle keeps the zip self-describing and is idempotent across runs.
$staged = @(
    @{ Source = (Join-Path $Root "LICENSE"); Name = "LICENSE" },
    @{ Source = (Join-Path $Root "NOTICE"); Name = "NOTICE" },
    @{ Source = (Join-Path $Root "THIRD-PARTY-NOTICES.md"); Name = "THIRD-PARTY-NOTICES.md" }
)

foreach ($file in $staged) {
    if (-not (Test-Path -LiteralPath $file.Source -PathType Leaf)) {
        Write-Failure "missing repository file: $($file.Source)"
    }
    Copy-Item -LiteralPath $file.Source -Destination (Join-Path $Bundle $file.Name) -Force
}

$required = @(
    "lockedin_desktop.exe",
    "lockedin-core.exe",
    "data/flutter_assets/NOTICES.Z",
    "LICENSE",
    "NOTICE",
    "THIRD-PARTY-NOTICES.md",
    $KeyringEntry
)

foreach ($entry in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Bundle $entry))) {
        Write-Failure "missing bundle entry: $entry`nrun scripts/desktop-build.sh windows (without LOCKEDIN_SKIP_KEYRING) first"
    }
}

# The addon's JS entry alone is useless: `bun build --compile` cannot embed the
# native binary, so a bundle without one ships a core with no keychain backend.
# scripts/desktop-build.sh copies the platform binary beside its package and
# flat beside `index.js`; either location satisfies the check.
$nativeAddons = @()
if (Test-Path -LiteralPath $KeyringDir -PathType Container) {
    $nativeAddons = @(Get-ChildItem -LiteralPath $KeyringDir -Filter "*.node" -File)
}
if ($nativeAddons.Count -eq 0) {
    $napiRoot = Join-Path $Bundle "node_modules/@napi-rs"
    if (Test-Path -LiteralPath $napiRoot -PathType Container) {
        $nativeAddons = @(Get-ChildItem -LiteralPath $napiRoot -Filter "*.node" -File -Recurse)
    }
}
if ($nativeAddons.Count -eq 0) {
    Write-Failure "missing native keyring addon: no *.node under node_modules/@napi-rs in $Bundle`nrun scripts/desktop-build.sh windows (without LOCKEDIN_SKIP_KEYRING) first"
}

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
if (Test-Path -LiteralPath $Artifact) {
    Remove-Item -LiteralPath $Artifact -Force
}

# `-Path "<bundle>\*"` stores the bundle's contents at the archive root, so an
# extracted zip has lockedin_desktop.exe next to lockedin-core.exe.
Write-Host "packaging: $Bundle"
Compress-Archive -Path (Join-Path $Bundle "*") -DestinationPath $Artifact -CompressionLevel Optimal
if (-not (Test-Path -LiteralPath $Artifact -PathType Leaf)) {
    Write-Failure "Compress-Archive produced no artifact: $Artifact"
}

# Verify the archive itself, not just the staged directory: a wrong -Path or an
# omitted file must fail here rather than on the user's machine.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($Artifact)
try {
    $names = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) {
        # Zip entry names are forward-slash separated; normalise just in case.
        [void]$names.Add(($entry.FullName -replace '\\', '/'))
    }
} finally {
    $archive.Dispose()
}

foreach ($name in $names) {
    if ($name -match '^([A-Za-z]:|/|\\)') {
        Write-Failure "archive entry is not relative: $name"
    }
}

foreach ($entry in $required) {
    if (-not $names.Contains($entry)) {
        Write-Failure "missing archive entry: $entry"
    }
}

$hasAddon = @($names | Where-Object { $_ -like "*.node" }).Count -gt 0
if (-not $hasAddon) {
    Write-Failure "missing archive entry: a native keyring *.node addon"
}

$bytes = (Get-Item -LiteralPath $Artifact).Length
$mebibytes = [math]::Round($bytes / 1MB, 1)
Write-Host "artifact: $Artifact"
Write-Host "size: $mebibytes MiB ($bytes bytes)"
Write-Host "keychain addon: $($nativeAddons[0].Name)"
Write-Host "entries: $($names.Count)"

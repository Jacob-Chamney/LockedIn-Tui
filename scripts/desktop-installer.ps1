#Requires -Version 5.1
<#
.SYNOPSIS
  Build an unsigned per-user Windows installer for the desktop release.

.DESCRIPTION
  Turns the bundle produced by scripts/desktop-build.sh windows into one NSIS
  setup executable. The bundle is the same one scripts/desktop-package.ps1
  zips, so the installer and the portable archive cannot disagree about what
  ships.

  Shape of the install:
    - per-user, no elevation (`RequestExecutionLevel user`), into
      `%LOCALAPPDATA%\Programs\LockedIn`
    - Start-menu shortcut, an `Uninstall.exe` and an entry under
      `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`
    - the workspace (`%USERPROFILE%\LockedIn`) and the app data
      (`%LOCALAPPDATA%\lockedin`) are **user data**: the install folder and the
      uninstaller never touch them

  The setup executable is **unsigned**. Authenticode signing needs a certificate
  the project does not have yet, so SmartScreen will warn on first run; that is
  recorded in the release notes rather than hidden.

  Output: dist/lockedin-desktop-windows-x64-setup.exe (plus the generated
  dist/lockedin-desktop-windows-x64.nsi, kept so the script that built the
  installer is inspectable).

.PARAMETER Verify
  Install the setup silently, assert the installed files, then uninstall
  silently and assert the folder is gone. This is what CI runs, so the
  installer is proven on the runner rather than only assembled.

.PARAMETER Makensis
  Path to makensis.exe. Discovered from PATH or the default NSIS install
  location when omitted.

.EXAMPLE
  pwsh ./scripts/desktop-installer.ps1 -Verify
#>
[CmdletBinding()]
param(
    [switch]$Verify,
    [string]$Makensis = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Bundle = Join-Path $Root "desktop/build/windows/x64/runner/Release"
$Dist = Join-Path $Root "dist"
$Setup = Join-Path $Dist "lockedin-desktop-windows-x64-setup.exe"
$Script = Join-Path $Dist "lockedin-desktop-windows-x64.nsi"

# The bundle's own addon entry: the shell points the core at this file with
# LOCKEDIN_KEYRING_ADDON (desktop/lib/bridge/core_client.dart).
$KeyringEntry = "node_modules/@napi-rs/keyring/index.js"

# One error = one message and a non-zero exit. Never print a stack trace for an
# expected refusal, and never echo an environment value: nothing here needs a
# secret.
function Write-Failure {
    param([Parameter(Mandatory = $true)][string]$Message)
    [Console]::Error.WriteLine("desktop-installer: $Message")
    exit 1
}

# The installer must never ship a bundle that cannot start. The zip packer
# checks the same list, so a missing piece fails both artifacts identically.
$required = @(
    "lockedin_desktop.exe",
    "lockedin-core.exe",
    "data/flutter_assets/NOTICES.Z",
    "LICENSE",
    "NOTICE",
    "THIRD-PARTY-NOTICES.md",
    $KeyringEntry
)

if (-not (Test-Path -LiteralPath $Bundle -PathType Container)) {
    Write-Failure "missing bundle: $Bundle`nrun scripts/desktop-build.sh windows first"
}
foreach ($entry in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Bundle $entry))) {
        Write-Failure "missing bundle entry: $entry`nrun scripts/desktop-build.sh windows (without LOCKEDIN_SKIP_KEYRING) first"
    }
}

# The JS entry alone is useless: `bun build --compile` cannot embed the native
# binary, so a bundle without a .node ships a core with no keychain backend.
$napiRoot = Join-Path $Bundle "node_modules/@napi-rs"
$nativeAddons = @(Get-ChildItem -LiteralPath $napiRoot -Filter "*.node" -File -Recurse -ErrorAction SilentlyContinue)
if ($nativeAddons.Count -eq 0) {
    Write-Failure "missing native keyring addon: no *.node under $napiRoot`nrun scripts/desktop-build.sh windows (without LOCKEDIN_SKIP_KEYRING) first"
}

if ($Makensis -eq "") {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "NSIS/makensis.exe"),
        (Join-Path $env:ProgramFiles "NSIS/makensis.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "NSIS/makensis.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
    if ($candidates.Count -gt 0) {
        $Makensis = $candidates[0]
    } else {
        $command = Get-Command makensis -ErrorAction SilentlyContinue
        if ($null -eq $command) {
            Write-Failure "makensis is not installed; install NSIS (choco install nsis -y) and re-run"
        }
        $Makensis = $command.Source
    }
}

# The app version comes from package.json, the same source the core's version.ts
# is generated from, so the installer's display version cannot drift.
$packageJson = Join-Path $Root "package.json"
if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
    Write-Failure "missing package.json: $packageJson"
}
$version = (Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($version)) {
    Write-Failure "package.json has no version"
}
# VIProductVersion needs four numeric parts; a dated version like 2026.11.12
# becomes 2026.11.12.0.
$numeric = @(($version -split "[^0-9]+") | Where-Object { $_ -ne "" })
while ($numeric.Count -lt 4) { $numeric += "0" }
$productVersion = ($numeric[0..3] -join ".")

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
foreach ($path in @($Setup, $Script)) {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
    }
}

# NSIS paths are quoted; the bundle lives under the build directory, whose
# parents can contain spaces on a developer machine.
$nsi = @"
Unicode true
SetCompressor /SOLID lzma
Name "LockedIn"
OutFile "$Setup"
InstallDir "`$LOCALAPPDATA\Programs\LockedIn"
InstallDirRegKey HKCU "Software\LockedIn" "InstallDir"
RequestExecutionLevel user
BrandingText "LockedIn"
VIProductVersion "$productVersion"
VIAddVersionKey "ProductName" "LockedIn"
VIAddVersionKey "FileDescription" "LockedIn desktop setup (unsigned)"
VIAddVersionKey "FileVersion" "$version"
VIAddVersionKey "ProductVersion" "$version"
VIAddVersionKey "LegalCopyright" "AGPL-3.0-only"

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "LockedIn" SEC_MAIN
  SetShellVarContext current
  SetOutPath "`$INSTDIR"
  File /r "$Bundle\*.*"
  WriteUninstaller "`$INSTDIR\Uninstall.exe"
  CreateDirectory "`$SMPROGRAMS\LockedIn"
  CreateShortcut "`$SMPROGRAMS\LockedIn\LockedIn.lnk" "`$INSTDIR\lockedin_desktop.exe"
  WriteRegStr HKCU "Software\LockedIn" "InstallDir" "`$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn" "DisplayName" "LockedIn"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn" "DisplayVersion" "$version"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn" "Publisher" "LockedIn"
  ; NSIS treats ' as a string delimiter too, so the stored value keeps the
  ; quotes Windows needs without a second level of escaping.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn" "UninstallString" '"`$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn" "InstallLocation" "`$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "`$SMPROGRAMS\LockedIn\LockedIn.lnk"
  RMDir "`$SMPROGRAMS\LockedIn"
  ; Only the program folder: `%USERPROFILE%\LockedIn` (the workspace) and
  ; `%LOCALAPPDATA%\lockedin` (app data) are the user's and stay.
  RMDir /r "`$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn"
  DeleteRegKey HKCU "Software\LockedIn"
SectionEnd
"@

# No BOM: NSIS 3 reads a script as its own encoding, and the text is ASCII.
[System.IO.File]::WriteAllText($Script, $nsi, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "installer: $Script"
Write-Host "nsis: $Makensis"
& $Makensis $Script
if ($LASTEXITCODE -ne 0) {
    Write-Failure "makensis failed with exit code $LASTEXITCODE"
}
if (-not (Test-Path -LiteralPath $Setup -PathType Leaf)) {
    Write-Failure "makensis produced no installer: $Setup"
}

$bytes = (Get-Item -LiteralPath $Setup).Length
if ($bytes -lt 5MB) {
    # The bundle alone is ~68 MiB; a smaller setup means the files were not
    # embedded (a wrong File /r path compiles happily).
    Write-Failure "installer is only $bytes bytes; the bundle was probably not embedded"
}
Write-Host ("artifact: $Setup")
Write-Host ("size: {0:N0} bytes ({1:N1} MiB)" -f $bytes, ($bytes / 1MB))

if (-not $Verify) {
    Write-Host "verification skipped (pass -Verify to install and uninstall it)"
    exit 0
}

# Install and uninstall it for real. The workspace and the app data folder are
# checked afterwards: a silent install that wiped them would be a product bug,
# not an installer detail.
$installDir = Join-Path $env:LOCALAPPDATA "Programs/LockedIn"
$workspace = Join-Path $env:USERPROFILE "LockedIn"
$dataDir = Join-Path $env:LOCALAPPDATA "lockedin"

foreach ($marker in @($workspace, $dataDir)) {
    if (-not (Test-Path -LiteralPath $marker)) {
        New-Item -ItemType Directory -Force -Path $marker | Out-Null
    }
}

function Invoke-Setup {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $process = Start-Process -FilePath $Setup -ArgumentList $Arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        Write-Failure "setup exited with $($process.ExitCode)"
    }
}

Write-Host "verify: silent install"
Invoke-Setup -Arguments @("/S")
foreach ($entry in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $installDir $entry))) {
        Write-Failure "installed file missing: $entry"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $installDir "Uninstall.exe" -PathType Leaf))) {
    Write-Failure "the installer did not write Uninstall.exe"
}
$shellKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LockedIn"
if (-not (Test-Path -LiteralPath $shellKey)) {
    Write-Failure "the uninstall registry entry is missing"
}
$folderBytes = (Get-ChildItem -LiteralPath $installDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ("verify: installed {0:N1} MiB into {1}" -f ($folderBytes / 1MB), $installDir)

Write-Host "verify: silent uninstall"
$uninstaller = Join-Path $installDir "Uninstall.exe"
$process = Start-Process -FilePath $uninstaller -ArgumentList @("/S") -Wait -PassThru
if ($process.ExitCode -ne 0) {
    Write-Failure "uninstaller exited with $($process.ExitCode)"
}
if (Test-Path -LiteralPath $installDir) {
    # NSIS removes the folder synchronously in silent mode; a leftover is a bug.
    $left = @(Get-ChildItem -LiteralPath $installDir -Recurse -File -ErrorAction SilentlyContinue)
    if ($left.Count -gt 0) {
        Write-Failure "uninstall left $($left.Count) file(s) in $installDir"
    }
    Remove-Item -LiteralPath $installDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $shellKey) {
    Write-Failure "uninstall left the registry entry behind"
}
foreach ($marker in @($workspace, $dataDir)) {
    if (-not (Test-Path -LiteralPath $marker)) {
        Write-Failure "uninstall removed user data: $marker"
    }
}
Write-Host "verify: install and uninstall clean, user data untouched"

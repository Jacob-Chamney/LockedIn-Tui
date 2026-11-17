import { expect, test } from "bun:test"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const INSTALLER_SCRIPT = join(ROOT, "scripts", "desktop-installer.ps1")
const WORKFLOW = join(ROOT, ".github", "workflows", "desktop.yml")

test("the Windows installer script exists and is not empty", async () => {
  const info = await stat(INSTALLER_SCRIPT)
  expect(info.isFile()).toBe(true)
  expect(info.size).toBeGreaterThan(1000)
})

test("the installer is per-user and needs no elevation", async () => {
  const source = await readFile(INSTALLER_SCRIPT, "utf8")
  // A per-user install is the only kind that works without an admin prompt on a
  // managed machine, and it keeps the uninstaller out of Program Files.
  expect(source).toContain("RequestExecutionLevel user")
  expect(source).toContain("$LOCALAPPDATA\\Programs\\LockedIn")
  expect(source).toContain("InstallDirRegKey HKCU")
  // No machine-wide or elevated writes anywhere.
  expect(source).not.toContain("RequestExecutionLevel admin")
  expect(source).not.toContain("HKLM")
})

test("the uninstaller removes the program and never the user's data", async () => {
  const source = await readFile(INSTALLER_SCRIPT, "utf8")
  // The here-string escapes PowerShell's `$` with a backtick, so the NSIS line
  // is RMDir /r "$INSTDIR" once the script is written out.
  expect(source).toContain('RMDir /r "`$INSTDIR"')
  expect(source).toContain("DeleteRegKey HKCU")
  // The workspace (`%USERPROFILE%\\LockedIn`) and the app data
  // (`%LOCALAPPDATA%\\lockedin`) are user data: no recursive delete may name
  // them, and the verify pass asserts they survive an uninstall.
  expect(source).not.toContain('RMDir /r "`$PROFILE')
  expect(source).not.toContain('RMDir /r "`$LOCALAPPDATA')
  expect(source).toContain("uninstall removed user data")
})

test("the installer ships the same contract the zip does", async () => {
  const source = await readFile(INSTALLER_SCRIPT, "utf8")
  // The entries a recipient needs, including the native keychain addon: a
  // compiled core cannot embed it, so an installer without it ships a core with
  // no keychain backend.
  for (const entry of [
    "lockedin_desktop.exe",
    "lockedin-core.exe",
    "data/flutter_assets/NOTICES.Z",
    "LICENSE",
    "NOTICE",
    "THIRD-PARTY-NOTICES.md",
    "node_modules/@napi-rs/keyring",
    "*.node",
    "lockedin-desktop-windows-x64-setup.exe",
  ]) {
    expect(source).toContain(entry)
  }
  // A setup smaller than the bundle means `File /r` embedded nothing; NSIS
  // compiles that happily, so it is checked explicitly.
  expect(source).toContain("5MB")
  // The display version comes from package.json, the same source of truth as
  // the core's version.ts.
  expect(source).toContain("package.json")
  expect(source).toContain("VIProductVersion")
})

test("the installer is proven by installing and uninstalling it", async () => {
  const source = await readFile(INSTALLER_SCRIPT, "utf8")
  expect(source).toContain("-Verify")
  expect(source).toContain('Invoke-Setup -Arguments @("/S")')
  expect(source).toContain("Uninstall.exe")
  expect(source).toContain("WriteUninstaller")
  // No secret can reach the installer or its log.
  expect(source).not.toContain("secrets.")
})

test("the Windows CI job builds and verifies the installer", async () => {
  const workflow = await readFile(WORKFLOW, "utf8")
  expect(workflow).toContain("desktop-installer.ps1 -Verify")
  expect(workflow).toContain("lockedin-desktop-windows-x64-setup.exe")
  expect(workflow).toContain("choco install nsis")
  // Still a build job: read-only, no upload, no privileged trigger.
  expect(workflow).toContain("contents: read")
  expect(workflow).not.toContain("secrets.")
  expect(workflow).not.toContain("actions/upload-artifact")
  expect(workflow).not.toContain("pull_request_target")
})

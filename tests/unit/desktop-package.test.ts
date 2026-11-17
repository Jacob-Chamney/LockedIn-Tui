import { expect, test } from "bun:test"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const PACKAGE_SCRIPT = join(ROOT, "scripts", "desktop-package.sh")
const WINDOWS_PACKAGE_SCRIPT = join(ROOT, "scripts", "desktop-package.ps1")
const BUILD_SCRIPT = join(ROOT, "scripts", "desktop-build.sh")
const WORKFLOW = join(ROOT, ".github", "workflows", "desktop.yml")
const SMOKE_SCRIPT = join(ROOT, "scripts", "desktop-smoke.sh")

test("a self-hosted Windows workflow exists for repositories without minutes", async () => {
  const workflow = await readFile(join(ROOT, ".github", "workflows", "desktop-selfhosted.yml"), "utf8")
  expect(workflow).toContain("workflow_dispatch")
  expect(workflow).toContain("self-hosted")
  expect(workflow).toContain("desktop-build.sh windows")
  expect(workflow).toContain("desktop-package.ps1")
  expect(workflow).toContain("contents: read")
  // No upload, secret or deploy step: it only builds and checks.
  expect(workflow).not.toContain("secrets.")
  expect(workflow).not.toContain("upload-artifact")
})

test("the sidecar is compiled as a release build", async () => {
  // `UNLOCK_ALL_ACHIEVEMENTS = !RELEASE_BUILD`: a packaged core without the
  // define unlocks the whole achievement catalogue on first launch, so this is
  // a product bug, not a build detail.
  const script = await readFile(BUILD_SCRIPT, "utf8")
  expect(script).toContain("LOCKEDIN_RELEASE")
  expect(script).toContain("LOCKEDIN_APP_VERSION")
})

test("the packaging script exists and is executable", async () => {
  const info = await stat(PACKAGE_SCRIPT)
  expect(info.isFile()).toBe(true)
  // Windows has no POSIX mode bits, so asserting them there failed the Windows
  // runner. The portable contract is: a file with a shebang that CI can invoke.
  const head = ((await readFile(PACKAGE_SCRIPT, "utf8")).split("\n")[0] ?? "")
  expect(head.startsWith("#!")).toBe(true)
  if (process.platform !== "win32") {
    expect(info.mode & 0o111).not.toBe(0)
  }
})

test("the build script bundles the native keyring addon", async () => {
  const source = await readFile(BUILD_SCRIPT, "utf8")
  // `bun build --compile` cannot embed a .node addon, so the release bundle
  // carries `@napi-rs/keyring` and the platform package beside the sidecar.
  expect(source).toContain("@napi-rs/keyring")
  expect(source).toContain("keyring-linux-x64-gnu")
  expect(source).toContain("keyring-win32-x64-msvc")
  expect(source).toContain("LOCKEDIN_KEYRING_ADDON")
  // The shell points the core at the bundled addon with this variable.
  expect(source).toContain("$BUNDLE/node_modules/@napi-rs")
  // A build without the addon must fail by name, not ship a secret-tool-only
  // core; the documented opt-out keeps a keychain-less build possible.
  expect(source).toContain("missing keyring addon")
  expect(source).toContain("LOCKEDIN_SKIP_KEYRING")
})

test("the packaging script refuses a bundle without a native addon", async () => {
  const source = await readFile(PACKAGE_SCRIPT, "utf8")
  expect(source).toContain("@napi-rs/keyring")
  expect(source).toContain("node_modules/@napi-rs/keyring/index.js")
  // A .node file is the real payload; the JS entry alone cannot reach a keychain.
  expect(source).toContain("find \"$BUNDLE/node_modules/@napi-rs\" -name '*.node'")
  expect(source).toContain("missing native keyring addon")
})

test("the packaging script carries the release contract", async () => {
  const source = await readFile(PACKAGE_SCRIPT, "utf8")
  // Named entries the archive must contain, plus the archive tool itself.
  for (const entry of [
    "lockedin_desktop",
    "lockedin-core",
    "LICENSE",
    "NOTICE",
    "THIRD-PARTY-NOTICES.md",
    "NOTICES.Z",
    "tar",
    "lib/libflutter_linux_gtk.so",
  ]) {
    expect(source).toContain(entry)
  }
  // Reuse the CI build rather than rebuilding Flutter inside packaging.
  expect(source).toContain("--no-build")
  expect(source).toContain("set -euo pipefail")
})

test("the Linux CI job packages the tarball and keeps read-only permissions", async () => {
  const workflow = await readFile(WORKFLOW, "utf8")
  expect(workflow).toContain("scripts/desktop-package.sh --no-build")
  expect(workflow).toContain("contents: read")
  // The packaged core must stay executable; CI asserts it explicitly.
  expect(workflow).toContain("test -x desktop/build/linux/x64/release/bundle/lockedin-core")
  // No secret, upload or deploy steps may creep into this workflow.
  expect(workflow).not.toContain("secrets.")
  expect(workflow).not.toContain("actions/upload-artifact")
  expect(workflow).not.toContain("pull_request_target")
})

test("the Windows packaging script exists and stages the release contract", async () => {
  const info = await stat(WINDOWS_PACKAGE_SCRIPT)
  expect(info.isFile()).toBe(true)
  expect(info.size).toBeGreaterThan(0)

  const source = await readFile(WINDOWS_PACKAGE_SCRIPT, "utf8")
  // Every entry the zip must carry: the shell, the bundled core, the Flutter
  // notices and the three licence/notice files staged by the script itself.
  for (const entry of [
    "lockedin_desktop.exe",
    "lockedin-core.exe",
    "data/flutter_assets/NOTICES.Z",
    "LICENSE",
    "NOTICE",
    "THIRD-PARTY-NOTICES.md",
    "node_modules/@napi-rs/keyring",
    "Compress-Archive",
    "lockedin-desktop-windows-x64.zip",
  ]) {
    expect(source).toContain(entry)
  }
  // Reuse the CI release build rather than rebuilding Flutter inside packaging.
  expect(source).toContain("[switch]$NoBuild")
  expect(source).toContain("desktop/build/windows/x64/runner/Release")
  // A native .node is the real keychain payload; the addon is checked by name.
  expect(source).toContain("*.node")
  expect(source).toContain("missing native keyring addon")
  // The zip is inspected after writing, not only the staged folder.
  expect(source).toContain("ZipFile")
  // Packaging must never hold or print a secret.
  expect(source).not.toContain("secrets.")
})

test("the Windows CI job packages the zip and keeps read-only permissions", async () => {
  const workflow = await readFile(WORKFLOW, "utf8")
  expect(workflow).toContain("desktop-package.ps1 -NoBuild")
  expect(workflow).toContain("shell: pwsh")
  expect(workflow).toContain("lockedin-desktop-windows-x64.zip")
  expect(workflow).toContain("contents: read")
  // Windows packaging is a build result, not a release: no upload, secret or
  // privileged trigger.
  expect(workflow).not.toContain("secrets.")
  expect(workflow).not.toContain("actions/upload-artifact")
  expect(workflow).not.toContain("pull_request_target")
})

test("the packaged build has a smoke test a tester can run", async () => {
  const info = await stat(SMOKE_SCRIPT)
  expect(info.isFile()).toBe(true)
  const head = ((await readFile(SMOKE_SCRIPT, "utf8")).split("\n")[0] ?? "")
  expect(head.startsWith("#!")).toBe(true)

  const source = await readFile(SMOKE_SCRIPT, "utf8")
  // It must prove the shell painted, the core booted and the sidecar ran, and
  // it must use throwaway state so a smoke test can never touch real data.
  for (const needle of [
    "lockedin_desktop",
    "lockedin-core",
    "workspace.json",
    "import -window",
    "identify -format",
    "Xvfb",
    "dbus-run-session",
    "LOCKEDIN_WORKSPACE",
    "LOCKEDIN_DATA_DIR",
    "--bundle",
    "--keep",
  ]) {
    expect(source).toContain(needle)
  }
  // A blank frame is not a pass: the colour count is asserted.
  expect(source).toContain('COLORS" -lt 8')
  // Nothing here may reach a secret or a real keychain.
  expect(source).not.toContain("secrets.")
})

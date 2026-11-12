#!/usr/bin/env bun
/**
 * Platform smoke test for a built release directory.
 *
 * The release matrix builds on native runners. A successful compile is not
 * evidence that the file runs, so every job executes the binaries it just
 * built before uploading them:
 *
 *   bun run scripts/smoke.ts --dir=dist --version=2026.11.12
 *
 * Checks, per host artifact:
 *   1. `--version` prints `lockedin <version>` and exits 0;
 *   2. on Linux and macOS, the UI starts under a pty, paints its first screen
 *      and creates the requested workspace.
 *
 * Windows runners have no pty, so only the version check runs there. Cross-built
 * artifacts for another architecture are skipped; each runner tests its own.
 */
import { existsSync } from "node:fs"
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const PAINT_TIMEOUT_MS = 15_000
const VERSION_TIMEOUT_MS = 15_000

function hostLibc(): "glibc" | "musl" {
  if (existsSync("/etc/alpine-release")) return "musl"
  return existsSync("/lib/ld-musl-x86_64.so.1") || existsSync("/lib/ld-musl-aarch64.so.1")
    ? "musl"
    : "glibc"
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

function fail(message: string): never {
  console.error(`smoke: ${message}`)
  process.exit(1)
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

async function runVersion(binary: string, cwd: string, expected: string): Promise<void> {
  const proc = Bun.spawn([binary, "--version"], {
    cwd,
    env: {
      ...process.env,
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      USERPROFILE: cwd,
      TERM: "xterm-256color",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => proc.kill(), VERSION_TIMEOUT_MS)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  const reported = stdout.trim()
  if (code !== 0 || reported !== `lockedin ${expected}`) {
    fail(
      `${binary} --version exited ${code} and printed ${JSON.stringify(reported)}` +
        (stderr.trim() ? `\nstderr: ${stderr.trim()}` : "") +
        `\nexpected: lockedin ${expected}`,
    )
  }
}

type Painted = { painted: boolean; output: string }

async function readUntilPaint(proc: ReturnType<typeof Bun.spawn>): Promise<Painted> {
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  const deadline = Date.now() + PAINT_TIMEOUT_MS
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now())
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(remaining).then(() => "timeout" as const),
      ])
      if (chunk === "timeout") break
      if (chunk.done) break
      output += decoder.decode(chunk.value, { stream: true })
      if (output.includes("LOCKEDIN")) return { painted: true, output }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { painted: false, output }
}

async function runUi(binary: string, root: string): Promise<string> {
  const home = join(root, "home")
  const data = join(root, "data")
  const workspace = join(root, "workspace")
  await mkdir(home, { recursive: true })
  const env = {
    ...process.env,
    PATH: process.env.PATH ?? "",
    HOME: home,
    USERPROFILE: home,
    XDG_DATA_HOME: data,
    LOCKEDIN_DATA_DIR: data,
    TERM: "xterm-256color",
  }
  const command = [binary, "--workspace", workspace].map(quote).join(" ")
  const proc =
    process.platform === "darwin"
      ? Bun.spawn(["script", "-q", "/dev/null", binary, "--workspace", workspace], {
          cwd: root,
          env,
          stdout: "pipe",
          stderr: "pipe",
        })
      : Bun.spawn(["script", "-qfec", command, "/dev/null"], {
          cwd: root,
          env,
          stdout: "pipe",
          stderr: "pipe",
        })
  try {
    const painted = await readUntilPaint(proc)
    if (!painted.painted) {
      const tail = painted.output.replaceAll("\u0000", "").trim().slice(-600)
      fail(`the UI did not paint "LOCKEDIN" within ${PAINT_TIMEOUT_MS} ms` + (tail ? `\noutput tail:\n${tail}` : ""))
    }
    if (!existsSync(join(workspace, "workspace.json"))) {
      fail(`the UI painted but did not create ${join(workspace, "workspace.json")}`)
    }
    return workspace
  } finally {
    proc.kill()
    await proc.exited
  }
}

const dir = resolve(option("dir") ?? "dist")
if (!existsSync(dir)) fail(`release directory not found: ${dir}`)

const version = option("version")
if (!version) fail("--version=<release version> is required")

const os = process.platform === "win32" ? "windows" : process.platform
const arch = process.arch
const expectedPrefix = `lockedin-${version}-`
// A musl binary needs the musl loader; a glibc host cannot execute it. Match
// the host libc instead of claiming a cross-libc launch.
const libc = os === "linux" ? hostLibc() : "glibc"
const candidates = (await readdir(dir))
  .filter((file) => file.startsWith(expectedPrefix) && file.includes(`-${os}-${arch}`))
  .filter((file) => (os === "windows" ? file.endsWith(".exe") : !file.endsWith(".exe")))
  .filter((file) => (os === "linux" ? file.includes("-musl") === (libc === "musl") : true))
  .sort()

if (candidates.length === 0) {
  fail(`no ${os}-${arch} (${libc}) artifact named ${expectedPrefix}* in ${dir}`)
}

const root = await mkdtemp(join(tmpdir(), "lockedin-smoke-"))
try {
  for (const file of candidates) {
    const source = join(dir, file)
    const info = await stat(source)
    if (!info.isFile() || info.size === 0) fail(`${file} is not a non-empty file`)
    const local = join(root, os === "windows" ? "lockedin.exe" : "lockedin")
    await copyFile(source, local)
    if (os !== "windows") await Bun.$`chmod +x ${local}`.quiet()
    await runVersion(local, root, version)
    console.log(`smoke ${file}: --version ok`)
    if (os !== "windows") {
      const workspace = await runUi(local, join(root, `run-${file}`))
      console.log(`smoke ${file}: first paint ok, workspace ${workspace}`)
    } else {
      console.log(`smoke ${file}: UI launch skipped (no pty on Windows runners)`)
    }
    await rm(local, { force: true })
  }
  console.log(`smoke: ${candidates.length} artifact(s) verified on ${os}-${arch}`)
} finally {
  await rm(root, { recursive: true, force: true })
}

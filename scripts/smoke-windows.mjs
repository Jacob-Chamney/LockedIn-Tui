/**
 * Windows UI smoke.
 *
 * The Windows runner has no `script` binary, so the regular smoke script can
 * only check `--version`. This runs the real console binary under ConPTY via
 * node-pty, waits for the first `LOCKEDIN` paint and checks the workspace.
 *
 * Run by the Windows release job after installing node-pty in a temp directory:
 *   node smoke.mjs --dir=dist --version=2026.11.12
 *
 * The dependency is CI-only; it is never bundled into the app.
 */
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { spawn } from "@homebridge/node-pty-prebuilt-multiarch"

const PAINT_TIMEOUT_MS = 20_000

function option(name) {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

const dir = resolve(option("dir") ?? "dist")
const version = option("version")
if (!version) {
  console.error("smoke-windows: --version=<release version> is required")
  process.exit(2)
}
if (!existsSync(dir)) {
  console.error(`smoke-windows: release directory not found: ${dir}`)
  process.exit(2)
}

const prefix = `lockedin-${version}-bun-windows-x64`
const artifact = (await readdir(dir))
  .filter((file) => file.startsWith(prefix) && file.endsWith(".exe"))
  .sort()[0]
if (!artifact) {
  console.error(`smoke-windows: no ${prefix}*.exe in ${dir}`)
  process.exit(1)
}

const root = await mkdtemp(join(tmpdir(), "lockedin-win-smoke-"))
const local = join(root, "lockedin.exe")
const home = join(root, "home")
const data = join(root, "data")
const workspace = join(root, "workspace")

try {
  const info = await stat(join(dir, artifact))
  if (!info.isFile() || info.size === 0) {
    console.error(`smoke-windows: ${artifact} is not a non-empty file`)
    process.exit(1)
  }
  await copyFile(join(dir, artifact), local)
  await mkdir(home, { recursive: true })

  const env = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key]
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_DATA_HOME: data,
    LOCKEDIN_DATA_DIR: data,
    TERM: "xterm-256color",
  })

  const pty = spawn(local, ["--workspace", workspace], {
    name: "xterm-256color",
    cols: 120,
    rows: 36,
    cwd: root,
    env,
    useConpty: true,
  })

  let output = ""
  let settled = false
  const painted = await new Promise((resolvePaint) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolvePaint(false)
    }, PAINT_TIMEOUT_MS)
    pty.onData((chunk) => {
      output += chunk
      if (!settled && output.includes("LOCKEDIN")) {
        settled = true
        clearTimeout(timer)
        resolvePaint(true)
      }
    })
    pty.onExit(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePaint(output.includes("LOCKEDIN"))
    })
  })

  try {
    pty.kill()
  } catch {
    // The process may already have exited.
  }
  // Windows can hold the executable briefly after the pty closes.
  await new Promise((resolve) => setTimeout(resolve, 500))

  if (!painted) {
    const tail = output.replace(/[\u0000-\u001f]/g, " ").trim().slice(-800)
    console.error(`smoke-windows: no LOCKEDIN paint in ${PAINT_TIMEOUT_MS} ms`)
    if (tail) console.error(tail)
    process.exit(1)
  }
  if (!existsSync(join(workspace, "workspace.json"))) {
    console.error(`smoke-windows: painted but did not create ${join(workspace, "workspace.json")}`)
    process.exit(1)
  }
  console.log(`smoke-windows: ${basename(artifact)} first paint ok, workspace created`)
} finally {
  // A leftover temp directory is harmless; a false failure is not.
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }).catch(
    () => {},
  )
}

/**
 * Restart the installed app after an in-place update.
 *
 * The updater replaces the executable at `process.execPath`; running that path
 * again starts the new version. POSIX uses `execve`, so the terminal session
 * keeps the same pid and the switch is immediate. Windows cannot replace a
 * running image, so the updater renames it aside; there we spawn the new
 * executable and exit.
 *
 * Only release builds restart. A source run has no updater, and tests must not
 * replace the test process.
 */
import { RELEASE_BUILD } from "../version"

export type RelaunchDeps = {
  /** Defaults to the build flag; tests pass an explicit value. */
  release?: boolean
  execPath?: string
  /** User arguments only, after the runtime and entry point. */
  argv?: readonly string[]
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  /** Runs before the switch (the renderer uses it to restore the terminal). */
  prepare?: () => void
  execve?: ((file: string, args?: readonly string[], env?: NodeJS.ProcessEnv) => never) | null
  spawn?: (cmd: string[], env: Record<string, string | undefined>) => unknown
  exit?: (code: number) => void
}

export type RelaunchResult = { ok: true } | { ok: false; message: string }

function spawnDetached(cmd: string[], env: Record<string, string | undefined>): unknown {
  return Bun.spawn({
    cmd,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
}

export function relaunch(deps: RelaunchDeps = {}): RelaunchResult {
  const release = deps.release ?? RELEASE_BUILD
  if (!release) return { ok: false, message: "restart LockedIn to run the new version" }

  const execPath = deps.execPath ?? process.execPath
  // A compiled Bun binary reports ["bun", "/$bunfs/root/<name>", ...userArgs],
  // and a source run reports [bun, script, ...userArgs]; the user arguments
  // start at index 2 in both.
  const argv = deps.argv ?? process.argv.slice(2)
  const env = deps.env ?? process.env
  const platform = deps.platform ?? process.platform
  const args = [execPath, ...argv]

  try {
    deps.prepare?.()
    if (platform !== "win32") {
      const execve = deps.execve === undefined ? process.execve : deps.execve
      if (execve) {
        // Does not return on success.
        execve(execPath, args, env)
        return { ok: false, message: "could not restart LockedIn" }
      }
    }
    ;(deps.spawn ?? spawnDetached)(args, env)
    ;(deps.exit ?? process.exit)(0)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `could not restart LockedIn: ${message}` }
  }
}

/**
 * Workspace and data-directory layout (WP-101).
 *
 * Two roots, deliberately separate:
 *
 * - the **workspace** (`~/LockedIn` by default) holds Markdown, sessions,
 *   outputs, the index cache and `config.toml`;
 * - the **data directory** (`$XDG_DATA_HOME/lockedin` on Linux) holds usage,
 *   stats, Chill history, the activity log and logs — never inside the
 *   workspace, never in an archive (`docs/data-model.md` §1.1).
 *
 * This module is pure: no IO, no environment mutation. Every path is derived
 * from an explicit root so tests and the app agree without machine-specific
 * constants.
 */

import { homedir } from "node:os"
import { isAbsolute, join, resolve, sep } from "node:path"

/** The only supported on-disk schema for a v1 workspace. */
export const WORKSPACE_SCHEMA = 1

/** Marker file that distinguishes a v1 workspace from a legacy v0.7 folder. */
export const MARKER_FILE = "workspace.json"

/** Config lives in the workspace and is human-editable. */
export const CONFIG_FILE = "config.toml"

export type WorkspacePaths = {
  root: string
  /** `workspace.json` */
  marker: string
  /** `config.toml` */
  config: string
  schoolVault: string
  schoolSessions: string
  skillVault: string
  goals: string
  workProjects: string
  archiveIndex: string
  attachments: string
  exports: string
  /** Convenience folder for source files; nothing is required to live there. */
  input: string
  /** Outside `root`, always. */
  dataDir: string
}

/**
 * Directories a workspace owns, relative to its root.
 *
 * `docs/data-model.md` §1 fixes the names. Only these are created; an existing
 * folder that contains anything else at its top level is not adopted.
 */
export const LAYOUT_DIRS = [
  "school/vault/concepts",
  "school/vault/sessions",
  "school/vault/sources",
  "school/sessions",
  "school/outputs",
  "skills/vault/goals",
  "skills/vault/sources",
  "skills/goals",
  "work/projects",
  "work/templates",
  "archive-index",
  "attachments",
  "exports",
  "input",
] as const

/** Top-level names a workspace owns. Used to tell "partial" from "foreign". */
export const LAYOUT_TOP_LEVEL = [
  "school",
  "skills",
  "work",
  "archive-index",
  "attachments",
  "exports",
  "input",
] as const

/** Files kept in the data directory, outside the workspace. */
export type DataPaths = {
  dir: string
  chill: string
  usage: string
  stats: string
  activity: string
  logs: string
}

type Env = Record<string, string | undefined>

function envValue(env: Env, key: string): string | undefined {
  const value = env[key]
  return value && value.trim() !== "" ? value : undefined
}

/**
 * `~/LockedIn`, or `$LOCKEDIN_WORKSPACE` when set.
 *
 * An explicit `HOME` in `env` wins over the process home so a test can boot a
 * throwaway home directory without touching the real one.
 */
export function defaultWorkspaceRoot(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = envValue(env, "LOCKEDIN_WORKSPACE")
  if (override) return resolve(override)
  // Git Bash on Windows exports a POSIX `HOME` (`/c/Users/...`); preferring
  // `USERPROFILE` keeps the default folder a real Windows path.
  const home =
    platform === "win32"
      ? envValue(env, "USERPROFILE") ?? homedir()
      : envValue(env, "HOME") ?? homedir()
  return join(home, "LockedIn")
}

/**
 * Platform data directory: `~/.local/share/lockedin` (or
 * `$XDG_DATA_HOME/lockedin`), `~/Library/Application Support/lockedin` on
 * macOS, `%LOCALAPPDATA%\lockedin` on Windows.
 */
export function defaultDataDir(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const override = envValue(env, "LOCKEDIN_DATA_DIR")
  if (override) return resolve(override)

  if (platform === "win32") {
    const local = envValue(env, "LOCALAPPDATA") ?? join(homedir(), "AppData", "Local")
    return join(local, "lockedin")
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "lockedin")
  }
  const xdg = envValue(env, "XDG_DATA_HOME") ?? join(homedir(), ".local", "share")
  return join(xdg, "lockedin")
}

/**
 * Derive every path from a workspace root. `dataDir` defaults to the platform
 * data directory but is injectable, which is what keeps integration tests off
 * the real home directory.
 */
export function workspacePaths(
  root: string,
  dataDir: string = defaultDataDir(),
): WorkspacePaths {
  const abs = resolve(root)
  return {
    root: abs,
    marker: join(abs, MARKER_FILE),
    config: join(abs, CONFIG_FILE),
    schoolVault: join(abs, "school", "vault"),
    schoolSessions: join(abs, "school", "sessions"),
    skillVault: join(abs, "skills", "vault"),
    goals: join(abs, "skills", "goals"),
    workProjects: join(abs, "work", "projects"),
    archiveIndex: join(abs, "archive-index"),
    attachments: join(abs, "attachments"),
    exports: join(abs, "exports"),
    input: join(abs, "input"),
    dataDir: resolve(dataDir),
  }
}

/** Every layout directory, absolute, in creation order. */
export function layoutDirs(paths: WorkspacePaths): string[] {
  return LAYOUT_DIRS.map((rel) => join(paths.root, ...rel.split("/")))
}

export function dataPaths(dataDir: string = defaultDataDir()): DataPaths {
  const dir = resolve(dataDir)
  return {
    dir,
    chill: join(dir, "chill.json"),
    usage: join(dir, "usage.json"),
    stats: join(dir, "stats.json"),
    activity: join(dir, "activity.jsonl"),
    logs: join(dir, "logs"),
  }
}

/**
 * Join a caller-supplied id or file name under `root`, refusing anything that
 * would escape it. Returns null for empty, absolute, NUL-bearing or `..` paths.
 *
 * This is the one guard for ids read back from disk (`meta.json`) and for
 * remote-supplied names; a plain `join` is not a confinement.
 */
export function confinedJoin(root: string, ...parts: string[]): string | null {
  if (parts.length === 0) return null
  for (const part of parts) {
    if (part === "" || part.includes("\0") || isAbsolute(part)) return null
    if (part.split(/[\\/]+/).some((segment) => segment === "..")) return null
  }
  const base = resolve(root)
  const target = resolve(join(base, ...parts))
  if (target === base || !isPathInside(base, target)) return null
  return target
}

/** True when `child` is `parent` or inside it (after `resolve`). */
export function isPathInside(parent: string, child: string): boolean {
  const p = resolve(parent)
  const c = resolve(child)
  // Windows compares paths case-insensitively; the uppercase drive letter is
  // the same drive whether a caller typed `c:\` or `C:\`.
  if (process.platform === "win32") {
    const lowerParent = p.toLowerCase()
    const lowerChild = c.toLowerCase()
    if (lowerParent === lowerChild) return true
    return lowerChild.startsWith(lowerParent.endsWith(sep) ? lowerParent : lowerParent + sep)
  }
  if (p === c) return true
  return c.startsWith(p.endsWith(sep) ? p : p + sep)
}

/**
 * The marker payload. Stable key order and a trailing newline so a git diff of
 * `workspace.json` is one line.
 */
export function markerContents(schema: number = WORKSPACE_SCHEMA): string {
  return `{"schema":${schema}}\n`
}

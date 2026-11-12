/**
 * Work project registration and home (WP-501).
 *
 * A project is a folder the user already owns. Registration is an *adoption of
 * metadata only*: this module writes `work/projects/<id>/meta.json` and nothing
 * else. It never moves, copies, renames or deletes the root, and never writes a
 * byte inside it (`docs/product.md` §8.1, `AGENTS.md` §2.12).
 *
 * Two facts are settled once and then trusted:
 *
 * - the root is stored **absolute and resolved** (`realpath`), so a registration
 *   through a symlink is the same project as a registration through the target;
 * - the id is `<slug>-<6 hex>`, hashed from the name and salted until it is free,
 *   so two projects with the same name stay distinct.
 *
 * Every expected failure is a typed value; nothing here throws and nothing
 * retries. Reads (git detection, counts) degrade instead of failing, because a
 * project whose folder vanished from disk must still list and must still be
 * removable from the workspace.
 */

import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { constants } from "node:fs"
import { access, mkdir, open, readdir, readFile, realpath, rename, rm, rmdir, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import { slugify } from "../../domain/note"
import { confinedJoin, isPathInside } from "../../storage/paths"
import type { Workspace } from "../../storage/workspace"

/** v1 on-disk schema for `work/projects/<id>/meta.json`. */
export const WORK_PROJECT_SCHEMA = 1

export const META_FILE = "meta.json"

export const MAX_NAME_CHARS = 80
export const MAX_INSTRUCTIONS_CHARS = 20_000

export type WorkError =
  | {
      kind: "path"
      path: string
      reason: "escape" | "missing" | "symlink"
      message: string
    }
  | { kind: "storage"; path: string; message: string }
  | {
      /** The root is already registered; the existing project is named. */
      kind: "duplicate"
      path: string
      existingId: string
      existingName: string
      message: string
    }
  | { kind: "invalid-input"; field: string; message: string }
  | { kind: "invalid-meta"; path: string; field: string; message: string }

/**
 * The documented shape of `meta.json` (`docs/data-model.md` §6.1).
 *
 * `agents` and `tasks` are owned by later packets (WP-503/WP-506); this module
 * only counts them and reads one agent name, so they stay `unknown[]` here and
 * are narrowed at the point of use. That keeps a future field change from
 * becoming a rewrite of registration.
 */
export type WorkMode = "chat" | "swarm"

export type ProjectMeta = {
  schema: number
  id: string
  name: string
  /** Absolute, symlink-resolved, never rewritten after registration. */
  root: string
  instructions: string
  default_agent: string
  agents: unknown[]
  tasks: unknown[]
  /** How the project is worked in. Patched on the same meta.json. */
  mode: WorkMode
  /** The swarm's display name when mode is `swarm`; defaults to the project name. */
  swarm_name: string
  /** Archived projects stay registered but hide their buffers. */
  archived: boolean
  created: string
  last_opened_at: string
}

export type ProjectRow = {
  id: string
  name: string
  root: string
  mode: WorkMode
  swarmName: string
  archived: boolean
  rootMissing: boolean
  lastOpenedAt: string
  /** A folder whose meta.json cannot be trusted; other rows still list. */
  broken: boolean
  reason?: string
}

export type ProjectHome = {
  id: string
  name: string
  root: string
  hasGit: boolean
  agentCount: number
  taskCount: number
  /** `""` when no profile is the default; a chat-mode project uses its implicit profile. */
  defaultAgentName: string
  lastOpenedAt: string
  instructions: string
  /** The root vanished after registration: metadata stays, files are gone. */
  rootMissing: boolean
}

export type RegisteredProject = {
  meta: ProjectMeta
  folder: string
  metaPath: string
}

export type RemovePlan = {
  id: string
  name: string
  root: string
  folder: string
  /** Confirmation copy: names the project and states that files are kept. */
  message: string
}

export type RemoveOutcome = {
  removed: boolean
  plan: RemovePlan
}

/* -------------------------------------------------------------------------- */
/* errors                                                                      */
/* -------------------------------------------------------------------------- */

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: string }).code
    : undefined
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = codeOf(error)
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

function storageError(path: string, error: unknown, message: string): WorkError {
  return { kind: "storage", path, message: `${message} (${describe(error)})` }
}

function missingError(path: string, message: string): WorkError {
  return { kind: "path", path, reason: "missing", message }
}

/* -------------------------------------------------------------------------- */
/* identity                                                                    */
/* -------------------------------------------------------------------------- */

/** Lowercase ASCII slug for a project name; never returns "". */
export function projectSlug(name: string): string {
  return slugify(name, 48)
}

function shortHash(name: string, salt: number): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update(`work-project\u0000${name}\u0000${salt}`)
    .digest("hex")
  return digest.slice(0, 6)
}

/**
 * `<slug>-<6 hex>` from the name, salted until it is free.
 *
 * The result depends only on the name, the taken ids and the salt order, so two
 * runs over the same state agree. Two different names can still collide; the
 * loop is what makes the id unique, not the hash alone.
 */
export function projectId(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken)
  const slug = projectSlug(name)
  for (let salt = 0; ; salt++) {
    const candidate = `${slug}-${shortHash(name, salt)}`
    if (!used.has(candidate)) return candidate
  }
}

/** Names Windows reserves even with an extension, e.g. `con`, `nul.txt`. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** A project id is a single folder name; anything else is an escape attempt. */
export function assertProjectId(id: string): Result<string, WorkError> {
  if (
    id === "" ||
    id.startsWith(".") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\u0000") ||
    // Windows also folds these characters, trailing dots/spaces and reserved
    // device names. Rejecting them everywhere keeps the id one folder on every
    // platform a workspace can be moved between.
    /[<>:"|?*\u0000-\u001f]/.test(id) ||
    id.endsWith(".") ||
    id.endsWith(" ") ||
    WINDOWS_RESERVED.test(id)
  ) {
    return err({
      kind: "path",
      path: id,
      reason: "escape",
      message: `"${id}" is not a project id; ids are a single folder name`,
    })
  }
  return ok(id)
}

export function projectFolder(workspace: Workspace, id: string): string {
  return (
    confinedJoin(workspace.paths.workProjects, id) ??
    join(workspace.paths.workProjects, ".invalid-project")
  )
}

export function projectMetaPath(workspace: Workspace, id: string): string {
  return join(projectFolder(workspace, id), META_FILE)
}

/* -------------------------------------------------------------------------- */
/* meta codec                                                                  */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

/**
 * Parse `meta.json` without trusting it. An unknown extra key survives the
 * parse only when the caller re-serializes the raw record; registration writes
 * the shape it owns and later packets extend it, so this function is strict
 * about the fields that would break a write and lenient about the rest.
 */
export function parseProjectMeta(
  raw: unknown,
  path: string,
): Result<ProjectMeta, WorkError> {
  if (!isRecord(raw)) {
    return err({
      kind: "invalid-meta",
      path,
      field: "schema",
      message: "meta.json is not a JSON object",
    })
  }

  const fail = (field: string, message: string): Result<ProjectMeta, WorkError> =>
    err({ kind: "invalid-meta", path, field, message })

  if (raw.schema !== WORK_PROJECT_SCHEMA) {
    return fail(
      "schema",
      `expected schema ${WORK_PROJECT_SCHEMA}, found ${JSON.stringify(raw.schema)}`,
    )
  }
  const id = raw.id
  const name = raw.name
  const root = raw.root
  if (typeof id !== "string" || id === "") {
    return fail("id", "id must be a non-empty string")
  }
  if (typeof name !== "string" || name === "") {
    return fail("name", "name must be a non-empty string")
  }
  if (typeof root !== "string" || !isAbsolute(root)) {
    return fail("root", "root must be an absolute path")
  }
  if (raw.agents !== undefined && !Array.isArray(raw.agents)) {
    return fail("agents", "agents must be an array")
  }
  if (raw.tasks !== undefined && !Array.isArray(raw.tasks)) {
    return fail("tasks", "tasks must be an array")
  }

  const created = stringOr(raw.created, "")
  return ok({
    schema: WORK_PROJECT_SCHEMA,
    id,
    name,
    root,
    instructions: stringOr(raw.instructions, ""),
    default_agent: stringOr(raw.default_agent, ""),
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    mode: raw.mode === "swarm" ? "swarm" : "chat",
    swarm_name: stringOr(raw.swarm_name, ""),
    archived: raw.archived === true,
    created,
    last_opened_at: stringOr(raw.last_opened_at, created),
  })
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)
}

function agentName(value: unknown): string {
  if (!isRecord(value)) return ""
  return typeof value.name === "string" ? value.name : ""
}

function agentId(value: unknown): string {
  if (!isRecord(value)) return ""
  return typeof value.id === "string" ? value.id : ""
}

/* -------------------------------------------------------------------------- */
/* reads                                                                       */
/* -------------------------------------------------------------------------- */

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Git is optional and never invoked: `.git` may be a file (worktree) or a dir. */
async function detectGit(root: string): Promise<boolean> {
  return exists(join(root, ".git"))
}

async function readMetaFile(
  path: string,
): Promise<Result<ProjectMeta, WorkError>> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
      return err(missingError(path, "this project has no meta.json in this workspace"))
    }
    if (error instanceof SyntaxError) {
      return err({
        kind: "invalid-meta",
        path,
        field: "json",
        message: `meta.json is not valid JSON (${error.message})`,
      })
    }
    return err(storageError(path, error, "meta.json could not be read"))
  }
  return parseProjectMeta(raw, path)
}

/** Every project folder, skipping hidden and temporary entries. */
async function projectFolders(workspace: Workspace): Promise<string[]> {
  try {
    const entries = await readdir(workspace.paths.workProjects, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(workspace.paths.workProjects, entry.name))
      .sort()
  } catch (error) {
    if (codeOf(error) === "ENOENT") return []
    throw error
  }
}

/**
 * Every registered project.
 *
 * A folder with a broken `meta.json` becomes a `broken` row with a reason (the
 * session manager takes the same stance): one bad folder must not hide the
 * others, and a row the user can still remove is better than a silent gap.
 */
export async function listProjects(workspace: Workspace): Promise<ProjectRow[]> {
  const rows: ProjectRow[] = []
  for (const folder of await projectFolders(workspace)) {
    const id = basename(folder)
    const parsed = await readMetaFile(join(folder, META_FILE))
    if (!parsed.ok) {
      rows.push({
        id,
        name: id,
        root: "",
        mode: "chat",
        swarmName: "",
        archived: false,
        rootMissing: false,
        lastOpenedAt: "",
        broken: true,
        reason: parsed.error.message,
      })
      continue
    }
    const meta = parsed.value
    rows.push({
      id: meta.id,
      name: meta.name,
      root: meta.root,
      mode: meta.mode,
      swarmName: meta.swarm_name,
      archived: meta.archived,
      rootMissing: !(await exists(meta.root)),
      lastOpenedAt: meta.last_opened_at,
      broken: false,
    })
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export type HomeInput = { workspace: Workspace; id: string }

/**
 * One read for the project summary shown by the shell.
 *
 * Missing root ⇒ `rootMissing: true` and zero-ish counts are still reported;
 * unreadable meta ⇒ typed error. Git presence is a stat of `.git`, never a
 * subprocess (`WP-501` "Do not shell out to git").
 */
export async function home(input: HomeInput): Promise<Result<ProjectHome, WorkError>> {
  const id = assertProjectId(input.id)
  if (!id.ok) return id

  const folder = projectFolder(input.workspace, id.value)
  const parsed = await readMetaFile(join(folder, META_FILE))
  if (!parsed.ok) return parsed

  const meta = parsed.value
  const rootMissing = !(await exists(meta.root))
  const defaultAgentName =
    meta.default_agent === ""
      ? ""
      : agentName(meta.agents.find((agent) => agentId(agent) === meta.default_agent))

  return ok({
    id: meta.id,
    name: meta.name,
    root: meta.root,
    hasGit: rootMissing ? false : await detectGit(meta.root),
    agentCount: meta.agents.length,
    taskCount: meta.tasks.length,
    defaultAgentName,
    lastOpenedAt: meta.last_opened_at,
    instructions: meta.instructions,
    rootMissing,
  })
}

/* -------------------------------------------------------------------------- */
/* writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Temp file in the destination directory, fsync, rename, then fsync the
 * directory best-effort. A crash leaves the previous `meta.json` or the new one,
 * never half a file (`docs/data-model.md` §3).
 */
async function writeJsonAtomic(
  destination: string,
  value: unknown,
): Promise<Result<void, WorkError>> {
  const directory = dirname(destination)
  const temporary = join(directory, `.${META_FILE}.tmp-${randomUUID()}`)
  const payload = `${JSON.stringify(value, null, 2)}\n`
  let handle: Awaited<ReturnType<typeof open>> | undefined

  try {
    handle = await open(temporary, "w")
    await handle.writeFile(payload, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, destination)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // Nothing useful to do with a close failure here.
    }
    await rm(temporary, { force: true })
    return err(storageError(destination, error, "the project metadata could not be written"))
  }

  try {
    const dirHandle = await open(directory, "r")
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch {
    // Directory fsync is not supported everywhere; the rename already landed.
  }

  return ok(undefined)
}

function metaPayload(meta: ProjectMeta): Record<string, unknown> {
  return {
    schema: meta.schema,
    id: meta.id,
    name: meta.name,
    root: meta.root,
    instructions: meta.instructions,
    default_agent: meta.default_agent,
    agents: meta.agents,
    tasks: meta.tasks,
    mode: meta.mode,
    swarm_name: meta.swarm_name,
    archived: meta.archived,
    created: meta.created,
    last_opened_at: meta.last_opened_at,
  }
}

/* -------------------------------------------------------------------------- */
/* register                                                                    */
/* -------------------------------------------------------------------------- */

export type RegisterInput = {
  workspace: Workspace
  /** The folder the user already owns. Never modified. */
  root: string
  name: string
  instructions?: string
  /**
   * Pre-computed id, so the shell can open the project's first buffer without
   * waiting for the metadata write. It is validated like any other id and is
   * refused when taken; the caller falls back to the derived id on refusal.
   */
  id?: string
  /** How the project is worked in. Defaults to a single agent. */
  mode?: WorkMode
}

function validateName(raw: string): Result<string, WorkError> {
  const name = raw.trim()
  if (name === "") {
    return err({ kind: "invalid-input", field: "name", message: "a project needs a name" })
  }
  if (name.length > MAX_NAME_CHARS) {
    return err({
      kind: "invalid-input",
      field: "name",
      message: `a project name is at most ${MAX_NAME_CHARS} characters`,
    })
  }
  return ok(name)
}

/**
 * Resolve the root to an absolute real path, or explain why it cannot be a
 * project:
 *
 * - missing → `path`/`missing`, unless `create` is set;
 * - a file, not a directory → `path`/`missing` with that sentence;
 * - no read permission → `storage` (the user cannot work in it either);
 * - a symlink escape is resolved first, then checked against the workspace.
 *
 * `create` belongs to the project wizard, not to `register`: a project is a
 * folder the user already owns, but "New project" may name a folder that does
 * not exist yet. Creating the leaf is explicit, never a silent replacement.
 */
export async function resolveProjectRoot(
  workspace: Workspace,
  raw: string,
  options: { create?: boolean; onCreated?: (path: string, ancestors: readonly string[]) => void } = {},
): Promise<Result<string, WorkError>> {
  const requested = raw.trim()
  if (requested === "") {
    return err({ kind: "invalid-input", field: "root", message: "a project needs a folder" })
  }

  // The shell suggests `~/Projects/<slug>`; `~` is a home-relative path, not a
  // literal folder name, so expand it before resolving.
  const expanded =
    requested === "~"
      ? homedir()
      : requested.startsWith("~/") || requested.startsWith(`~\\`)
        ? join(homedir(), requested.slice(2))
        : requested
  const absolute = resolve(expanded)

  let workspaceRoot: string
  try {
    workspaceRoot = await realpath(workspace.paths.root)
  } catch {
    workspaceRoot = workspace.paths.root
  }
  // Refuse before creating anything: a missing path under the workspace must
  // not leave a new empty folder behind just to fail the adoption check.
  if (isPathInside(workspaceRoot, absolute)) {
    return err({
      kind: "path",
      path: absolute,
      reason: "escape",
      message:
        `“${absolute}” is inside the LockedIn workspace. ` +
        "Workspace data cannot be adopted as a project; register a folder you own elsewhere.",
    })
  }

  let created = false
  let info
  try {
    info = await stat(absolute)
  } catch (error) {
    if ((codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") && options.create === true) {
      try {
        const missing: string[] = []
        let probe = absolute
        while (probe !== dirname(probe)) {
          const present = await stat(probe).then(() => true).catch(() => false)
          if (present) break
          missing.push(probe)
          probe = dirname(probe)
        }
        await mkdir(absolute, { recursive: true })
        created = true
        options.onCreated?.(absolute, missing)
        info = await stat(absolute)
      } catch (createError) {
        return err(storageError(absolute, createError, "the project folder could not be created"))
      }
    } else if (codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR") {
      return err(missingError(absolute, `“${absolute}” does not exist, so it cannot be registered`))
    } else {
      return err(storageError(absolute, error, "the project folder could not be inspected"))
    }
  }

  if (!info.isDirectory()) {
    return err(
      missingError(absolute, `“${absolute}” is a file, not a folder; register a directory`),
    )
  }

  try {
    await access(absolute, constants.R_OK)
  } catch (error) {
    return err(storageError(absolute, error, "the project folder is not readable"))
  }

  let resolvedRoot: string
  try {
    resolvedRoot = await realpath(absolute)
  } catch (error) {
    return err(storageError(absolute, error, "the project folder could not be resolved"))
  }

  if (isPathInside(workspaceRoot, resolvedRoot)) {
    if (created) await rmdir(absolute).catch(() => {})
    return err({
      kind: "path",
      path: resolvedRoot,
      reason: "escape",
      message:
        `“${resolvedRoot}” is inside the LockedIn workspace. ` +
        "Workspace data cannot be adopted as a project; register a folder you own elsewhere.",
    })
  }

  return ok(resolvedRoot)
}

/** The already-registered project for this exact root, if any. */
async function findByRoot(
  workspace: Workspace,
  root: string,
): Promise<Result<{ id: string; name: string } | null, WorkError>> {
  for (const folder of await projectFolders(workspace)) {
    const parsed = await readMetaFile(join(folder, META_FILE))
    if (!parsed.ok) continue
    if (parsed.value.root === root) {
      return ok({ id: parsed.value.id, name: parsed.value.name })
    }
  }
  return ok(null)
}

async function takenIds(workspace: Workspace): Promise<Set<string>> {
  const taken = new Set<string>()
  for (const folder of await projectFolders(workspace)) taken.add(basename(folder))
  return taken
}

/**
 * Register an existing folder.
 *
 * Writes exactly one thing: `work/projects/<id>/meta.json`. Nothing inside the
 * root is created, changed or removed — the tests compare a tree hash before
 * and after and expect equality. The project wizard may call
 * `resolveProjectRoot(..., { create: true })` first to create a missing leaf;
 * `register` itself always requires the folder to exist.
 *
 * Registering the same root twice is refused by naming the existing project;
 * it is never merged or duplicated. A root inside the workspace is refused
 * (`path`/`escape`) because workspace-owned data must not be adoptable.
 */
export async function register(
  input: RegisterInput,
): Promise<Result<RegisteredProject, WorkError>> {
  const name = validateName(input.name)
  if (!name.ok) return name

  const instructions = (input.instructions ?? "").trim()
  if (instructions.length > MAX_INSTRUCTIONS_CHARS) {
    return err({
      kind: "invalid-input",
      field: "instructions",
      message: `project instructions are at most ${MAX_INSTRUCTIONS_CHARS} characters`,
    })
  }

  const root = await resolveProjectRoot(input.workspace, input.root)
  if (!root.ok) return root

  const duplicate = await findByRoot(input.workspace, root.value)
  if (!duplicate.ok) return duplicate
  if (duplicate.value) {
    return err({
      kind: "duplicate",
      path: root.value,
      existingId: duplicate.value.id,
      existingName: duplicate.value.name,
      message:
        `“${duplicate.value.name}” already uses this folder (${root.value}). ` +
        "Open that project instead of registering it again.",
    })
  }

  const taken = await takenIds(input.workspace)
  const now = new Date().toISOString()

  const explicit = input.id === undefined ? null : assertProjectId(input.id)
  if (explicit !== null && !explicit.ok) return explicit
  if (explicit !== null && taken.has(explicit.value)) {
    return err({
      kind: "duplicate",
      path: projectFolder(input.workspace, explicit.value),
      existingId: explicit.value,
      existingName: explicit.value,
      message: `the project id “${explicit.value}” is already used in this workspace`,
    })
  }

  for (let attempt = 0; attempt < (explicit === null ? 8 : 1); attempt++) {
    const id = explicit?.value ?? projectId(name.value, taken)
    const folder = projectFolder(input.workspace, id)
    try {
      await mkdir(folder, { recursive: false })
    } catch (error) {
      if (codeOf(error) === "EEXIST") {
        taken.add(id)
        continue
      }
      return err(storageError(folder, error, "the project folder could not be created"))
    }

    const meta: ProjectMeta = {
      schema: WORK_PROJECT_SCHEMA,
      id,
      name: name.value,
      root: root.value,
      instructions,
      default_agent: "",
      agents: [],
      tasks: [],
      mode: input.mode === "swarm" ? "swarm" : "chat",
      swarm_name: "",
      archived: false,
      created: now,
      last_opened_at: now,
    }

    const written = await writeJsonAtomic(join(folder, META_FILE), metaPayload(meta))
    if (!written.ok) {
      // The folder is metadata we just created; remove it so a failed
      // registration leaves no half-made project. The root is untouched.
      await rm(folder, { recursive: true, force: true })
      return written
    }

    return ok({ meta, folder, metaPath: join(folder, META_FILE) })
  }

  return err({
    kind: "invalid-input",
    field: "name",
    message: "no free project id could be derived from this name; try another name",
  })
}

/* -------------------------------------------------------------------------- */
/* open stamp                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Record that the user opened the project. A home screen shows
 * `lastOpenedAt`, so the value must advance; only `last_opened_at` is rewritten
 * and every other key in `meta.json` — including keys a later packet adds — is
 * preserved (`docs/data-model.md` §8: JSON keys the operation does not own are
 * never dropped).
 */
export async function markOpened(
  input: HomeInput,
): Promise<Result<ProjectHome, WorkError>> {
  const id = assertProjectId(input.id)
  if (!id.ok) return id

  const path = projectMetaPath(input.workspace, id.value)
  const parsed = await readMetaFile(path)
  if (!parsed.ok) return parsed

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
  } catch (error) {
    return err(storageError(path, error, "meta.json could not be re-read before the open stamp"))
  }

  const written = await writeJsonAtomic(path, {
    ...raw,
    last_opened_at: new Date().toISOString(),
  })
  if (!written.ok) return written

  return home(input)
}

/**
 * Change how a project is worked in. Only `mode` is written; every other key
 * in `meta.json` is preserved.
 */
export async function setMode(input: {
  workspace: Workspace
  id: string
  mode: WorkMode
  swarmName?: string
}): Promise<Result<ProjectRow, WorkError>> {
  const id = assertProjectId(input.id)
  if (!id.ok) return id

  const path = projectMetaPath(input.workspace, id.value)
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
  } catch (error) {
    return err(storageError(path, error, "meta.json could not be read before changing its mode"))
  }
  const mode = input.mode === "swarm" ? "swarm" : "chat"
  const swarm_name =
    input.swarmName !== undefined ? input.swarmName : stringOr(raw.swarm_name, "")
  const written = await writeJsonAtomic(path, { ...raw, mode, swarm_name })
  if (!written.ok) return written

  const parsed = parseProjectMeta({ ...raw, mode, swarm_name }, path)
  if (!parsed.ok) return parsed
  const meta = parsed.value
  return ok({
    id: meta.id,
    name: meta.name,
    root: meta.root,
    mode: meta.mode,
    swarmName: meta.swarm_name,
    archived: meta.archived,
    rootMissing: !(await exists(meta.root)),
    lastOpenedAt: meta.last_opened_at,
    broken: false,
  })
}

/**
 * Toggle the archived flag on a project's metadata.
 *
 * Archive is a UI state, not a move: the root is untouched and the project
 * stays registered. Only `archived` is written; every other key is preserved.
 */
export async function setArchived(input: {
  workspace: Workspace
  id: string
  archived: boolean
}): Promise<Result<ProjectRow, WorkError>> {
  const id = assertProjectId(input.id)
  if (!id.ok) return id

  const path = projectMetaPath(input.workspace, id.value)
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
  } catch (error) {
    return err(storageError(path, error, "meta.json could not be read before archiving"))
  }
  const written = await writeJsonAtomic(path, { ...raw, archived: input.archived === true })
  if (!written.ok) return written
  const parsed = parseProjectMeta({ ...raw, archived: input.archived === true }, path)
  if (!parsed.ok) return parsed
  const meta = parsed.value
  return ok({
    id: meta.id,
    name: meta.name,
    root: meta.root,
    mode: meta.mode,
    swarmName: meta.swarm_name,
    archived: meta.archived,
    rootMissing: !(await exists(meta.root)),
    lastOpenedAt: meta.last_opened_at,
    broken: false,
  })
}

/* -------------------------------------------------------------------------- */
/* remove                                                                      */
/* -------------------------------------------------------------------------- */

export type RemoveInput = HomeInput & {
  /**
   * The confirmation gate. It receives copy that names the project and states
   * that files are kept. Returning false (or omitting the callback) cancels and
   * touches nothing.
   */
  approve?: (plan: RemovePlan) => boolean | Promise<boolean>
}

/**
 * Remove a project's **metadata only**.
 *
 * The plan is built first and handed to the caller's confirmation. Nothing is
 * deleted before an explicit `true`; a rejected confirmation returns
 * `{ removed: false }` with the plan so the UI can show it again. The project
 * root is never opened for writing, moved or deleted — the tests compare a tree
 * hash before and after removal and expect equality.
 */
export async function remove(
  input: RemoveInput,
): Promise<Result<RemoveOutcome, WorkError>> {
  const id = assertProjectId(input.id)
  if (!id.ok) return id

  const folder = projectFolder(input.workspace, id.value)
  const parsed = await readMetaFile(join(folder, META_FILE))
  if (!parsed.ok) return parsed

  const meta = parsed.value
  const plan: RemovePlan = {
    id: meta.id,
    name: meta.name,
    root: meta.root,
    folder,
    message:
      `Remove “${meta.name}” from LockedIn? ` +
      `Its files stay at ${meta.root}. ` +
      `Only the project metadata in ${folder} is deleted.`,
  }

  const approved = input.approve ? await input.approve(plan) : false
  if (!approved) return ok({ removed: false, plan })

  try {
    await rm(folder, { recursive: true, force: false })
  } catch (error) {
    return err(storageError(folder, error, "the project metadata could not be removed"))
  }

  return ok({ removed: true, plan })
}

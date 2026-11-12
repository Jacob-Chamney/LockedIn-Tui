/**
 * Workspace lifecycle: create, open, validate, diagnose (WP-101).
 *
 * Rules this module enforces:
 *
 * - `workspace.json` (`{"schema":1}`) is the only marker of a v1 workspace.
 *   A folder without it is never adopted, and a v0.7 folder is refused with a
 *   typed error and **zero writes** (`AGENTS.md` §2.8, `docs/data-model.md`
 *   §11).
 * - Creation is idempotent and retry-safe: an interrupted run leaves layout
 *   folders without the marker, and a second `createWorkspace()` finishes the
 *   job without deleting anything.
 * - The marker is written temp-file → fsync → rename, so a crash leaves either
 *   no marker or a complete one, never half a file.
 * - Errors are values (`Result`), matching `src/domain/markdown.ts`. Nothing
 *   here throws for an expected failure, and nothing retries on its own.
 */

import { constants } from "node:fs"
import type { Dirent } from "node:fs"
import { access, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"

import { err, ok, type Result } from "../domain/markdown"
import {
  CONFIG_FILE,
  LAYOUT_DIRS,
  LAYOUT_TOP_LEVEL,
  MARKER_FILE,
  WORKSPACE_SCHEMA,
  dataPaths,
  layoutDirs,
  markerContents,
  workspacePaths,
  type DataPaths,
  type WorkspacePaths,
} from "./paths"

const MARKER_TEMP_PREFIX = `.${MARKER_FILE}.tmp-`

export type WorkspaceError =
  | {
      /** A v0.7 folder: recognised, refused, never read or modified. */
      kind: "legacy"
      path: string
      message: string
      next: string
    }
  | {
      /** No marker, and not something `create()` may build on. */
      kind: "not-workspace"
      path: string
      message: string
      next: string
    }
  | {
      /** Marker present but unreadable or from another schema. */
      kind: "schema"
      path: string
      found: string
      expected: number
      message: string
      next: string
    }
  | {
      /** IO or permission failure. Always carries the failing path. */
      kind: "storage"
      path: string
      message: string
      next: string
    }

export type Diagnostic = {
  severity: "error" | "warning"
  code: string
  path?: string
  message: string
  /** One actionable sentence. Never "see logs". */
  next: string
}

export type Workspace = {
  root: string
  schema: number
  paths: WorkspacePaths
  data: DataPaths
}

export type WorkspaceKind =
  | "v1"
  | "legacy"
  | "empty"
  /** Layout folders exist but the marker is missing: an interrupted create. */
  | "partial"
  | "unmarked"
  | "missing"

/* -------------------------------------------------------------------------- */
/* errors                                                                      */
/* -------------------------------------------------------------------------- */

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  )
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

function storageError(
  path: string,
  error: unknown,
  message: string,
  next: string,
): WorkspaceError {
  return { kind: "storage", path, message: `${message} (${describeError(error)})`, next }
}

function legacyError(root: string): WorkspaceError {
  return {
    kind: "legacy",
    path: root,
    message:
      `“${basename(root)}” belongs to the old LockedIn (v0.7). ` +
      `It was not opened and nothing in it was read or changed.`,
    next:
      "Start with LOCKEDIN_WORKSPACE=~/LockedIn-Tui bun start, or point " +
      "LOCKEDIN_WORKSPACE at an existing v1 workspace.",
  }
}

function notWorkspaceError(root: string, message: string, next: string): WorkspaceError {
  return { kind: "not-workspace", path: root, message, next }
}

function markerSchemaError(path: string, found: string): WorkspaceError {
  return {
    kind: "schema",
    path,
    found,
    expected: WORKSPACE_SCHEMA,
    message: `This workspace declares schema ${found}; this build supports schema ${WORKSPACE_SCHEMA}.`,
    next: "Open it with the LockedIn build that wrote it, or choose another workspace folder.",
  }
}

/* -------------------------------------------------------------------------- */
/* inspection                                                                  */
/* -------------------------------------------------------------------------- */

function ignorable(name: string): boolean {
  return name.startsWith(MARKER_TEMP_PREFIX) || name === ".DS_Store"
}

function isLayoutName(name: string): boolean {
  return (LAYOUT_TOP_LEVEL as readonly string[]).includes(name)
}

/**
 * Classify a folder without writing to it.
 *
 * `legacy` is checked before `partial`/`unmarked` because a v0.7 folder also
 * contains `school/`; the marker-less v0.7 signature must win so that nothing
 * tries to "helpfully" complete it.
 */
export async function inspectWorkspace(
  root: string,
): Promise<Result<WorkspaceKind, WorkspaceError>> {
  const abs = resolve(root)

  let entries: Dirent[]
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch (error) {
    if (isErrno(error, "ENOENT")) return ok("missing")
    if (isErrno(error, "ENOTDIR")) return ok("unmarked")
    return err(
      storageError(
        abs,
        error,
        "The folder could not be read.",
        "Check that the path exists and that you can read it.",
      ),
    )
  }

  const names = new Set(entries.map((entry) => entry.name))

  if (names.has(MARKER_FILE)) return ok("v1")

  const legacySignature = names.has(CONFIG_FILE) && (names.has("school") || names.has("skills"))
  if (legacySignature) return ok("legacy")

  const relevant = entries.filter((entry) => !ignorable(entry.name))
  if (relevant.length === 0) return ok("empty")

  const onlyLayoutFolders = relevant.every(
    (entry) => entry.isDirectory() && isLayoutName(entry.name),
  )
  return ok(onlyLayoutFolders ? "partial" : "unmarked")
}

/** Read and validate `workspace.json`. */
export async function readWorkspaceMarker(
  paths: WorkspacePaths,
): Promise<Result<number, WorkspaceError>> {
  let raw: string
  try {
    raw = await readFile(paths.marker, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return err(
        notWorkspaceError(
          paths.root,
          "This folder has no workspace.json, so it is not a LockedIn workspace.",
          "Create a workspace here, or open a folder that already has workspace.json.",
        ),
      )
    }
    return err(
      storageError(
        paths.marker,
        error,
        "workspace.json could not be read.",
        "Check the file permissions and that the disk is readable.",
      ),
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return err(markerSchemaError(paths.marker, "invalid JSON"))
  }

  const schema =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { schema?: unknown }).schema
      : undefined

  if (typeof schema !== "number" || !Number.isInteger(schema)) {
    return err(markerSchemaError(paths.marker, "missing"))
  }
  if (schema !== WORKSPACE_SCHEMA) {
    return err(markerSchemaError(paths.marker, String(schema)))
  }
  return ok(schema)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false
    return false
  }
}

async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* open                                                                        */
/* -------------------------------------------------------------------------- */

export type OpenOptions = { dataDir?: string }

/**
 * Open an existing v1 workspace. Read-only: this function never creates a
 * directory and never writes a byte.
 */
export async function openWorkspace(
  root: string,
  options: OpenOptions = {},
): Promise<Result<Workspace, WorkspaceError>> {
  const paths = workspacePaths(root, options.dataDir)
  const kind = await inspectWorkspace(paths.root)
  if (!kind.ok) return kind

  switch (kind.value) {
    case "v1":
      break
    case "legacy":
      return err(legacyError(paths.root))
    case "missing":
      return err(
        notWorkspaceError(
          paths.root,
          "This folder does not exist.",
          "Create a workspace here, or pass a folder that already exists.",
        ),
      )
    case "empty":
      return err(
        notWorkspaceError(
          paths.root,
          "This folder is empty and is not a LockedIn workspace yet.",
          "Create a workspace here first (this build never adopts a folder silently).",
        ),
      )
    case "partial":
      return err(
        notWorkspaceError(
          paths.root,
          "This folder looks like an interrupted workspace: layout folders but no workspace.json.",
          "Run create for this folder to finish it — no existing file will be deleted.",
        ),
      )
    case "unmarked":
      return err(
        notWorkspaceError(
          paths.root,
          "This folder is not a LockedIn workspace; it has no workspace.json.",
          "Open a workspace folder, or create a new one in an empty folder.",
        ),
      )
  }

  const marker = await readWorkspaceMarker(paths)
  if (!marker.ok) return err(marker.error)

  return ok({
    root: paths.root,
    schema: marker.value,
    paths,
    data: dataPaths(paths.dataDir),
  })
}

/* -------------------------------------------------------------------------- */
/* create                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Write `contents` through temp file → fsync → rename (and fsync the directory
 * best-effort). The temp name is derived from the destination, so a crashed
 * run leaves a recognisable, ignorable file.
 */
async function writeFileAtomic(
  destination: string,
  contents: string,
): Promise<Result<void, WorkspaceError>> {
  const dir = dirname(destination)
  const temp = join(dir, `${MARKER_TEMP_PREFIX}${randomUUID()}`)
  let handle: Awaited<ReturnType<typeof open>> | undefined

  try {
    handle = await open(temp, "w")
    await handle.writeFile(contents, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, destination)
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // nothing useful to do with a close failure here
    }
    try {
      await rm(temp, { force: true })
    } catch {
      // a leftover temp file is ignorable by inspectWorkspace()
    }
    return err(
      storageError(
        destination,
        error,
        "The workspace marker could not be written.",
        "Choose a folder you can write to (for example ~/LockedIn-Tui) or fix its permissions.",
      ),
    )
  }

  try {
    const dirHandle = await open(dir, "r")
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

async function removeMarkerTemps(root: string): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(MARKER_TEMP_PREFIX)) {
      await rm(join(root, entry.name), { force: true })
    }
  }
}

/**
 * Create a v1 workspace, or finish an interrupted one.
 *
 * - Already v1 → identical to `openWorkspace()` (idempotent, no writes).
 * - Legacy v0.7 → typed refusal, no writes.
 * - Unmarked with foreign content → typed refusal, no writes.
 * - Empty / missing / partial layout → create the layout, then the marker.
 *
 * The marker is written last, so `workspace.json` always implies a complete
 * layout. Every intermediate state is retry-safe.
 */
export async function createWorkspace(
  root: string,
  options: OpenOptions = {},
): Promise<Result<Workspace, WorkspaceError>> {
  const paths = workspacePaths(root, options.dataDir)
  const kind = await inspectWorkspace(paths.root)
  if (!kind.ok) return kind

  switch (kind.value) {
    case "legacy":
      return err(legacyError(paths.root))
    case "unmarked":
      return err(
        notWorkspaceError(
          paths.root,
          "This folder is not empty and has no workspace.json, so it will not be adopted.",
          "Create the workspace in an empty folder, or move its files out first.",
        ),
      )
    case "v1":
      return openWorkspace(paths.root, options)
    case "empty":
    case "missing":
    case "partial":
      break
  }

  const data = dataPaths(paths.dataDir)

  try {
    await mkdir(paths.root, { recursive: true })
    await removeMarkerTemps(paths.root)
    await mkdir(data.dir, { recursive: true })
    await mkdir(data.logs, { recursive: true })
    for (const dir of layoutDirs(paths)) await mkdir(dir, { recursive: true })
  } catch (error) {
    return err(
      storageError(
        paths.root,
        error,
        "The workspace folders could not be created.",
        "Choose a folder you can write to or fix its permissions; nothing was deleted.",
      ),
    )
  }

  const written = await writeFileAtomic(paths.marker, markerContents())
  if (!written.ok) return written

  return openWorkspace(paths.root, options)
}

/* -------------------------------------------------------------------------- */
/* doctor                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every problem a user can act on, each with a next step. A healthy workspace
 * returns `[]` — the UI then shows nothing (`docs/design.md` §8).
 */
export async function doctor(workspace: Workspace): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const { paths } = workspace

  const marker = await readWorkspaceMarker(paths)
  if (!marker.ok) {
    diagnostics.push({
      severity: "error",
      code: "marker",
      path: paths.marker,
      message: marker.error.message,
      next: marker.error.next,
    })
  }

  for (const rel of LAYOUT_DIRS) {
    const dir = join(paths.root, ...rel.split("/"))
    if (!(await exists(dir))) {
      diagnostics.push({
        severity: "error",
        code: "missing-dir",
        path: dir,
        message: `The workspace is missing ${rel}/.`,
        next: "Run create for this workspace to restore the layout; existing notes are kept.",
      })
      continue
    }
    if (!(await isWritable(dir))) {
      diagnostics.push({
        severity: "error",
        code: "unwritable-dir",
        path: dir,
        message: `${rel}/ is not writable, so notes cannot be saved there.`,
        next: "Fix the folder permissions (or move the workspace) and run doctor again.",
      })
    }
  }

  if (!(await exists(paths.config))) {
    diagnostics.push({
      severity: "warning",
      code: "config-missing",
      path: paths.config,
      message: "config.toml is missing; defaults will be created on first load.",
      next: "Open the app once, or create config.toml to accept the documented defaults.",
    })
  }

  if (!(await exists(workspace.data.dir))) {
    diagnostics.push({
      severity: "error",
      code: "data-dir-missing",
      path: workspace.data.dir,
      message: "The app data directory is missing, so usage and stats cannot be saved.",
      next: "Create it (or let the next launch create it) and check it is writable.",
    })
  } else {
    if (!(await isWritable(workspace.data.dir))) {
      diagnostics.push({
        severity: "error",
        code: "unwritable-data-dir",
        path: workspace.data.dir,
        message: "The app data directory is not writable, so usage and stats will be lost.",
        next: "Fix its permissions or set LOCKEDIN_DATA_DIR to a writable folder.",
      })
    }
    if (!(await exists(workspace.data.logs))) {
      diagnostics.push({
        severity: "warning",
        code: "logs-missing",
        path: workspace.data.logs,
        message: "The log directory is missing; it is recreated on the next launch.",
        next: "No action needed unless this keeps happening.",
      })
    }
  }

  return diagnostics
}

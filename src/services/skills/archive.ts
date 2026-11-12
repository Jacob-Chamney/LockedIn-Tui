/** Archive and export one skill goal as a folder/zip. */
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises"
import { basename, join } from "node:path"

import type { ArchiveBackend } from "../../archive/types"
import { err, ok, type Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"
import { goalFolderFor } from "./delete"
import { writeZip, type ZipInput } from "../lockin/zip"

export type GoalArchiveError = { kind: "path" | "storage" | "archive"; path: string; message: string }

const EXCLUDED_ROOT = new Set(["chats"])
const EXCLUDED_NAMES = new Set([".tmp"])

async function collect(folder: string, root = folder): Promise<ZipInput[]> {
  const entries: ZipInput[] = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    if (folder === root && EXCLUDED_ROOT.has(entry.name)) continue
    if (EXCLUDED_NAMES.has(entry.name)) continue
    // A goal folder is app-owned, but a symlink in it must not turn an export
    // or archive into a copy of a file elsewhere on disk. Special files
    // (pipes, devices) would block a read, so only regular files are zipped.
    if (entry.isDirectory()) {
      const path = join(folder, entry.name)
      entries.push(...(await collect(path, root)))
      continue
    }
    if (!entry.isFile()) continue
    const path = join(folder, entry.name)
    const name = path.slice(root.length + 1).split("\\").join("/")
    entries.push({ name, data: new Uint8Array(await readFile(path)) })
  }
  return entries
}

export async function exportGoal(input: {
  workspace: Workspace
  id: string
}): Promise<Result<string, GoalArchiveError>> {
  const folder = goalFolderFor(input.workspace, input.id)
  if (!folder.ok) return err({ kind: "path", path: folder.error.path, message: folder.error.message })
  const target = join(input.workspace.paths.exports, `goal-${basename(folder.value)}.zip`)
  const temporary = `${target}.tmp-${crypto.randomUUID()}`
  try {
    const entries = await collect(folder.value)
    await mkdir(input.workspace.paths.exports, { recursive: true })
    await Bun.write(temporary, writeZip(entries))
    await rename(temporary, target)
    return ok(target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    return err({
      kind: "storage",
      path: target,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function archiveGoal(input: {
  workspace: Workspace
  id: string
  backend: ArchiveBackend
}): Promise<Result<string, GoalArchiveError>> {
  const folder = goalFolderFor(input.workspace, input.id)
  if (!folder.ok) return err({ kind: "path", path: folder.error.path, message: folder.error.message })
  const put = await input.backend.put(
    { side: "skills", id: input.id, backend: input.backend.id, kind: "goal" },
    folder.value,
  )
  if (!put.ok) return err({ kind: "archive", path: folder.value, message: put.error.message })
  if (put.value.warnings.length > 0) {
    return err({
      kind: "archive",
      path: folder.value,
      message: `the archive is incomplete (${put.value.warnings.length} skipped); the live goal was kept`,
    })
  }
  try {
    await rm(folder.value, { recursive: true, force: true })
    return ok(put.value.path)
  } catch (error) {
    return err({
      kind: "storage",
      path: folder.value,
      message: `the archive succeeded but the local goal could not be removed: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

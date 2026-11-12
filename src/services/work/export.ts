/**
 * Export a project's identity and staff as a small, deterministic zip.
 *
 * A project is a folder plus the way you work in it. The folder itself belongs
 * to the user and can be arbitrarily large, so this export writes metadata only:
 * `project.json` for machines and `README.md` for a person. The live project is
 * never touched.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { err, ok, type Result } from "../../domain/markdown"
import type { Workspace } from "../../storage/workspace"
import { writeZip, type ZipInput } from "../lockin/zip"

export type ProjectExportAgent = {
  name: string
  task: string
  model: string
  permissions: string
}

export type ProjectExportInput = {
  id: string
  name: string
  folder: string
  mode: "chat" | "swarm"
  archived: boolean
  agents: ProjectExportAgent[]
}

export type ProjectExportError = {
  kind: "path" | "storage"
  path: string
  message: string
}

/** The last segment of a path that may have been written on another OS. */
function folderNameOf(folder: string): string {
  return folder.split(/[\\/]+/).filter(Boolean).at(-1) ?? ""
}

/** Project ids are single folder names; the export name follows the same rule. */
function safeId(id: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return null
  return id
}

export function projectExportName(id: string): string | null {
  const safe = safeId(id)
  return safe === null ? null : `project-${safe}.zip`
}

function readmeFor(project: ProjectExportInput): string {
  // Never the absolute path: an export can be shared, and the archive rule
  // (`docs/product.md` §9) forbids machine paths in anything that leaves.
  const folderName = folderNameOf(project.folder)
  const mode =
    project.mode === "swarm"
      ? `swarm of ${project.agents.length} agent${project.agents.length === 1 ? "" : "s"}`
      : "single agent"
  const lines = [
    `# ${project.name}`,
    "",
    `- Folder: \`${folderName}\``,
    `- Mode: ${mode}`,
    `- Archived: ${project.archived ? "yes" : "no"}`,
    "",
  ]
  if (project.agents.length > 0) {
    lines.push("## Agents", "")
    for (const agent of project.agents) {
      const details = [
        agent.task === "" ? "" : agent.task,
        agent.model === "" ? "inherits the project model" : agent.model,
        agent.permissions,
      ].filter((part) => part !== "")
      lines.push(`- **${agent.name}** — ${details.join(" · ")}`)
    }
    lines.push("")
  }
  lines.push(
    "The project folder is not included. This export is the project definition,",
    "not the code it points at.",
    "",
  )
  return lines.join("\n")
}

export async function exportProject(input: {
  workspace: Workspace
  project: ProjectExportInput
}): Promise<Result<string, ProjectExportError>> {
  const file = projectExportName(input.project.id)
  if (file === null) {
    return err({
      kind: "path",
      path: input.project.id,
      message: `"${input.project.id}" is not a project id`,
    })
  }
  const target = join(input.workspace.paths.exports, file)
  const temporary = `${target}.tmp-${crypto.randomUUID()}`

  try {
    await mkdir(input.workspace.paths.exports, { recursive: true })
    const manifest = {
      schema: 1,
      id: input.project.id,
      name: input.project.name,
      folder: folderNameOf(input.project.folder),
      mode: input.project.mode,
      archived: input.project.archived,
      agents: input.project.agents,
    }
    const encoder = new TextEncoder()
    const entries: ZipInput[] = [
      { name: "project.json", data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) },
      { name: "README.md", data: encoder.encode(readmeFor(input.project)) },
    ]
    await writeFile(temporary, writeZip(entries))
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

/** Project export: definition and staff, never the user's code folder. */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { listZip, readZip } from "../../src/services/lockin/zip"
import { exportProject, projectExportName } from "../../src/services/work/export"
import { createWorkspace, type Workspace } from "../../src/storage/workspace"
import { removeTemp } from "../helpers/cleanup"

const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function workspace(): Promise<Workspace> {
  const base = await mkdtemp(join(tmpdir(), "work-export-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "workspace"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  return made.value
}

const PROJECT = {
  id: "project-1",
  name: "atlas",
  folder: "C:\\Users\\friend\\Projects\\atlas",
  mode: "swarm" as const,
  archived: false,
  agents: [
    { name: "planner", task: "plan the work", model: "openai/local", permissions: "read-only" },
    { name: "writer", task: "", model: "", permissions: "write" },
  ],
}

describe("project export", () => {
  test("writes project.json and README.md, with no copy of the folder", async () => {
    const ws = await workspace()
    const result = await exportProject({ workspace: ws, project: PROJECT })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value).toBe(join(ws.paths.exports, "project-project-1.zip"))
    expect(existsSync(result.value)).toBe(true)

    const bytes = new Uint8Array(await readFile(result.value))
    expect(listZip(bytes)).toEqual(["README.md", "project.json"])
    const manifest = JSON.parse(new TextDecoder().decode(readZip(bytes)["project.json"]!)) as Record<string, unknown>
    expect(manifest).toMatchObject({ ...PROJECT, folder: "atlas" })
    expect(JSON.stringify(manifest)).not.toContain("Users")
    const readme = new TextDecoder().decode(readZip(bytes)["README.md"]!)
    expect(readme).toContain("# atlas")
    expect(readme).toContain("planner")
    expect(readme).toContain("writer")
    expect(readme).toContain("not included")
    expect(readme).not.toContain("Users")

    // No temp file is left behind, and a second export is byte-identical.
    expect((await readdir(ws.paths.exports)).filter((name) => name.includes(".tmp-"))).toEqual([])
    const first = await readFile(result.value)
    const again = await exportProject({ workspace: ws, project: PROJECT })
    if (!again.ok) throw new Error(again.error.message)
    expect(new Uint8Array(await readFile(again.value))).toEqual(new Uint8Array(first))
  })

  test("an id that is not a folder name cannot become an export path", () => {
    expect(projectExportName("../escape")).toBeNull()
    expect(projectExportName("")).toBeNull()
    expect(projectExportName("project-1")).toBe("project-project-1.zip")
  })
})

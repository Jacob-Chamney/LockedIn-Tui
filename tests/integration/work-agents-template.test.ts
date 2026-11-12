/** Agent templates seed profiles; the default is a separate explicit choice. */
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTemp } from "../helpers/cleanup"
import { createWorkspace } from "../../src/storage/workspace"
import { register } from "../../src/services/work/register"
import { templatesDir } from "../../src/services/work/templates"
import {
  createAgentFromTemplate,
  loadProjectAgents,
  loadAgentTemplates,
  setProjectDefaultAgent,
} from "../../src/app/actions/projects"

const cleanup: string[] = []
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function project() {
  const base = await mkdtemp(join(tmpdir(), "work-agent-tpl-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const root = join(base, "atlas")
  await mkdir(root, { recursive: true })
  const registered = await register({ workspace: made.value, root, name: "Atlas", mode: "swarm" })
  if (!registered.ok) throw new Error(registered.error.message)
  return { workspace: made.value, id: registered.value.meta.id, metaPath: registered.value.metaPath }
}

test("templates seed a profile, and it is persisted", async () => {
  const { workspace, id, metaPath } = await project()
  const templates = await loadAgentTemplates(workspace)
  expect(templates.templates.map((template) => template.id)).toContain("reviewer")

  const created = await createAgentFromTemplate({ workspace, projectId: id, templateId: "reviewer" })
  if (!created.ok) throw new Error(created.error.message)
  expect(created.value.name).toBe("Reviewer")
  expect(created.value.permissions).toBe("read-only")

  const meta = JSON.parse(await readFile(metaPath, "utf8")) as { agents: unknown[] }
  expect(meta.agents).toHaveLength(1)
  expect((await loadProjectAgents(workspace, id)).map((agent) => agent.id)).toEqual([
    created.value.id,
  ])
})

test("a broken project template is reported, not silently hidden", async () => {
  const { workspace } = await project()
  const dir = templatesDir(workspace)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "broken.json"), "{ not json")
  const loaded = await loadAgentTemplates(workspace)
  expect(loaded.templates.map((template) => template.id)).toContain("reviewer")
  expect(loaded.issues.map((issue) => issue.file)).toEqual(["broken.json"])
})

test("the default agent is an explicit, persisted choice", async () => {
  const { workspace, id, metaPath } = await project()
  const created = await createAgentFromTemplate({ workspace, projectId: id, templateId: "researcher" })
  if (!created.ok) throw new Error(created.error.message)

  const set = await setProjectDefaultAgent({ workspace, projectId: id, id: created.value.id })
  expect(set.ok).toBe(true)
  const meta = JSON.parse(await readFile(metaPath, "utf8")) as { default_agent: string }
  expect(meta.default_agent).toBe(created.value.id)
})

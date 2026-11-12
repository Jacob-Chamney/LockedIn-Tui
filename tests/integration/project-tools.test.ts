/** A project chat gets the read-only toolbox bound to its own root. */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTemp } from "../helpers/cleanup"
import { createWorkspace, type Workspace } from "../../src/storage/workspace"
import { register } from "../../src/services/work/register"
import { projectTools } from "../../src/app/actions/projects"
import { createChatController } from "../../src/app/chat-controller"
import type { ChatRequest } from "../../src/llm/chat"

const cleanup: string[] = []

afterEach(async () => {
  for (const dir of cleanup.splice(0)) await removeTemp(dir)
})

async function project(): Promise<{ workspace: Workspace; id: string; root: string }> {
  const base = await mkdtemp(join(tmpdir(), "project-tools-"))
  cleanup.push(base)
  const made = await createWorkspace(join(base, "workspace"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const root = join(base, "atlas")
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "README.md"), "# atlas\n")
  await writeFile(join(root, "src", "main.ts"), "export const answer = 42\n")
  const registered = await register({
    workspace: made.value,
    root,
    name: "Atlas",
    instructions: "Prefer small diffs.",
  })
  if (!registered.ok) throw new Error(registered.error.message)
  return { workspace: made.value, id: registered.value.meta.id, root }
}

describe("project tool source", () => {
  test("reads files through the project scope", async () => {
    const { workspace, id, root } = await project()
    const tools = projectTools({ workspace, id, name: "Atlas", folder: root })
    if (tools === null) throw new Error("expected tools")

    expect(tools.specs.map((spec) => spec.name).sort()).toEqual([
      "list_files",
      "read_file",
      "search_files",
    ])
    const read = JSON.parse(await tools.resolveTool("read_file", { path: "src/main.ts" })) as {
      ok: boolean
      value?: { text: string }
    }
    expect(read.ok).toBe(true)
    expect(read.value?.text).toContain("answer = 42")
  })

  test("context names the project, its instructions and a file listing", async () => {
    const { workspace, id, root } = await project()
    const tools = projectTools({ workspace, id, name: "Atlas", folder: root })
    if (tools === null) throw new Error("expected tools")
    const context = await tools.context()
    expect(context).toContain("Atlas")
    expect(context).toContain("Prefer small diffs.")
    expect(context).toContain("README.md")
    expect(context).toContain("src/main.ts")
    expect(context).toContain("Writes and commands are off")
  })

  test("a controller puts the tools and project context on the request", async () => {
    const { workspace, id, root } = await project()
    const tools = projectTools({ workspace, id, name: "Atlas", folder: root })
    if (tools === null) throw new Error("expected tools")
    const seen: ChatRequest[] = []
    const controller = createChatController({
      scope: "work",
      service: {
        active: () => [],
        cancel() {},
        async *send(request: ChatRequest) {
          seen.push(request)
          yield { type: "done", text: "ok", steps: [], usage: { input: 1, output: 1, total: 2 } }
        },
      } as never,
      budget: { check: () => ({ block: null, state: {} as never }), overrideOnce() {}, key: () => "", isOverridden: () => false },
      history: { load: async () => [], save: async () => {} },
      config: () => ({
        model: "openai/gpt-4.1-mini",
        maxToolCalls: 8,
        maxTokens: 1000,
        chillHistoryLimit: 20,
        mode: "work",
        context: tools.context,
        tools: tools.specs,
        resolveTool: tools.resolveTool,
      }),
    })
    await controller.load()
    await controller.send("what is in main?")
    expect(seen[0]?.tools?.map((spec) => spec.name).sort()).toEqual([
      "list_files",
      "read_file",
      "search_files",
    ])
    expect(seen[0]?.messages[0]?.role).toBe("system")
    expect(seen[0]?.messages[0]?.content).toContain("Atlas")
    expect(seen[0]?.resolveTool).toBeDefined()
  })

  test("a vanished root is a typed tool error, not a throw", async () => {
    const { workspace, id, root } = await project()
    const tools = projectTools({ workspace, id, name: "Atlas", folder: root })
    if (tools === null) throw new Error("expected tools")
    await removeTemp(root)
    const result = JSON.parse(await tools.resolveTool("list_files", {})) as {
      ok: boolean
      error?: { kind: string; reason?: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error?.reason ?? result.error?.kind).toBeDefined()
  })
})

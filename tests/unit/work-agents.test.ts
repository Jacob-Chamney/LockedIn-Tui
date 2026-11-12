/**
 * WP-503 — agent profiles and templates.
 *
 * Every acceptance row from the packet is a test name below. The project is a
 * real temp workspace with a real registered folder, so "round-trip through
 * meta.json" means bytes on disk, not a mock. No test reads a user project and
 * no fixture carries a machine-specific path.
 *
 * The swarm rule is asserted here (not in WP-506) because the copy is the only
 * thing a worker ever receives, and a rule that cannot be tested until the
 * consumer lands is a rule nobody checks.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
/** `JSON.parse` is untyped; the tests index into it, so name the shape once. */
async function readJson(source: Promise<string>): Promise<{ agents: Array<Record<string, unknown>>; default_agent: string }> {
  return JSON.parse(await source) as { agents: Array<Record<string, unknown>>; default_agent: string }
}
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import type { ChatEvent } from "../../src/llm/events";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { KNOWN_TOOL_NAMES, MAX_TOOL_CALLS, MIN_TOOL_CALLS, agentId, createAgent, deleteAgent, effectiveToolNames, forSwarm, getAgent, listAgents, setDefaultAgent, updateAgent, validateAgent, type AgentError, type AgentProfile } from "../../src/services/work/agents";
import { NO_DEFAULT_AGENT, prepareTurn, type ChatEngine } from "../../src/services/work/chat";
import { projectMetaPath, register } from "../../src/services/work/register";
import { READ_ONLY_TOOL_NAMES } from "../../src/services/work/scope";
import { BUILT_IN_TEMPLATES, builtInTemplate, instantiateTemplate, listTemplates, saveProjectTemplate, templatesDir } from "../../src/services/work/templates";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const FIXTURES = join(import.meta.dir, "..", "fixtures", "work-agents", "templates")

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, AgentError>): AgentError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let projectRoot: string
let projectId: string

async function meta(): Promise<{ agents: Array<Record<string, unknown>>; default_agent: string }> {
  return readJson(readFile(projectMetaPath(workspace, projectId), "utf8"))
}

async function writeMeta(value: Record<string, unknown>): Promise<void> {
  await writeFile(projectMetaPath(workspace, projectId), `${JSON.stringify(value, null, 2)}\n`)
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "work-agents-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  projectRoot = join(base, "project")
  await mkdir(join(projectRoot, "src"), { recursive: true })
  await writeFile(join(projectRoot, "README.md"), "# Sample\n")
  projectId = unwrap(
    await register({ workspace, root: projectRoot, name: "My app" }),
  ).meta.id
})

afterEach(async () => {
  await removeTemp(base)
})

describe("agent profiles", () => {
  test("create, update and delete round-trip through meta.json", async () => {
    const reviewer = unwrap(
      await createAgent({
        workspace,
        projectId,
        name: "Reviewer",
        role: "reviewer",
        instructions: "Review only.",
        maxToolCalls: 8,
        allowedTools: ["list_files", "read_file", "search_files"],
      }),
    )
    const builder = unwrap(
      await createAgent({ workspace, projectId, name: "Builder", instructions: "Build." }),
    )

    const onDisk = await meta()
    expect(onDisk.agents).toHaveLength(2)
    expect(onDisk.default_agent).toBe("")
    expect(onDisk.agents[0]).toMatchObject({
      id: reviewer.id,
      name: "Reviewer",
      role: "reviewer",
      max_tool_calls: 8,
      allowed_tools: ["list_files", "read_file", "search_files"],
      allow_write: false,
      allow_command: false,
    })
    // snake_case on disk, camelCase in code.
    expect(onDisk.agents[0]).not.toHaveProperty("maxToolCalls")
    expect(onDisk.agents[1]).toMatchObject({ id: builder.id, role: "builder" })

    expect(unwrap(await listAgents(workspace, projectId))).toEqual({
      agents: [reviewer, builder],
      issues: [],
    })

    const renamed = unwrap(
      await updateAgent({
        workspace,
        projectId,
        id: reviewer.id,
        patch: { name: "Senior reviewer", model: "openai/gpt-4.1-mini" },
      }),
    )
    expect(renamed.id).toBe(reviewer.id)
    expect(unwrap(await getAgent(workspace, projectId, reviewer.id))).toEqual({
      ...reviewer,
      name: "Senior reviewer",
      model: "openai/gpt-4.1-mini",
    })

    const deleted = unwrap(
      await deleteAgent({ workspace, projectId, id: builder.id }),
    )
    expect(deleted).toEqual({ id: builder.id, defaultCleared: false })
    expect((await meta()).agents).toHaveLength(1)
    expect(unwrap(await listAgents(workspace, projectId)).agents[0]?.id).toBe(reviewer.id)
  })

  test("two agents cannot share a name in one project", async () => {
    unwrap(await createAgent({ workspace, projectId, name: "Reviewer" }))
    const before = await readFile(projectMetaPath(workspace, projectId), "utf8")

    const duplicate = errorOf(
      await createAgent({ workspace, projectId, name: "  reviewer  " }),
    )
    expect(duplicate.kind).toBe("invalid-input")
    expect(duplicate).toMatchObject({ field: "name" })
    expect(duplicate.message).toContain("reviewer")
    expect(await readFile(projectMetaPath(workspace, projectId), "utf8")).toBe(before)

    // The same name is fine in another project.
    const otherRoot = join(base, "other")
    await mkdir(otherRoot, { recursive: true })
    const other = unwrap(
      await register({ workspace, root: otherRoot, name: "Other app" }),
    ).meta.id
    unwrap(await createAgent({ workspace, projectId: other, name: "Reviewer" }))
  })

  test("maxToolCalls is bounded to 1–32", async () => {
    expect(MIN_TOOL_CALLS).toBe(1)
    expect(MAX_TOOL_CALLS).toBe(32)
    for (const value of [0, 33, 1.5]) {
      const refused = errorOf(
        await createAgent({ workspace, projectId, name: `Agent ${value}`, maxToolCalls: value }),
      )
      expect(refused.kind).toBe("invalid-input")
      expect(refused).toMatchObject({ field: "maxToolCalls" })
    }
    expect((await meta()).agents).toHaveLength(0)

    unwrap(await createAgent({ workspace, projectId, name: "Min", maxToolCalls: 1 }))
    unwrap(await createAgent({ workspace, projectId, name: "Max", maxToolCalls: 32 }))
    const stored = (await meta()).agents as Array<Record<string, unknown>>
    expect(stored.map((agent) => agent.max_tool_calls)).toEqual([1, 32])
  })

  test("an unknown tool name is refused by name", async () => {
    const refused = errorOf(
      await createAgent({
        workspace,
        projectId,
        name: "Telepath",
        allowedTools: ["list_files", "telepathy"],
      }),
    )
    expect(refused.kind).toBe("unknown-tool")
    expect(refused).toMatchObject({ tool: "telepathy", field: "allowedTools" })
    expect(refused.message).toContain("telepathy")
    expect(refused.message).toContain("list_files")
    expect((await meta()).agents).toHaveLength(0)

    // Every known name is accepted and duplicates collapse.
    const known = unwrap(
      await createAgent({
        workspace,
        projectId,
        name: "Known",
        allowedTools: [...KNOWN_TOOL_NAMES, "list_files"],
      }),
    )
    expect(known.allowedTools).toEqual([...KNOWN_TOOL_NAMES])
  })

  test("allowWrite and allowCommand are false when omitted", async () => {
    const agent = unwrap(await createAgent({ workspace, projectId, name: "Plain" }))
    expect(agent.allowWrite).toBe(false)
    expect(agent.allowCommand).toBe(false)
    expect(agent.maxToolCalls).toBe(8)
    expect(agent.allowedTools).toEqual([])
    expect(agent.template).toBe("")
    expect(agent.role).toBe("builder")

    const written = unwrap(
      await updateAgent({
        workspace,
        projectId,
        id: agent.id,
        patch: { allowWrite: true },
      }),
    )
    expect(written.allowWrite).toBe(true)
    expect(written.allowCommand).toBe(false)
  })

  test("setting a second default clears the first; a missing id is refused", async () => {
    const first = unwrap(await createAgent({ workspace, projectId, name: "First" }))
    const second = unwrap(await createAgent({ workspace, projectId, name: "Second" }))

    unwrap(await setDefaultAgent({ workspace, projectId, id: first.id }))
    expect((await meta()).default_agent).toBe(first.id)

    unwrap(await setDefaultAgent({ workspace, projectId, id: second.id }))
    const onDisk = await meta()
    expect(onDisk.default_agent).toBe(second.id)
    expect(
      (onDisk.agents as Array<{ id: string }>).filter(
        (agent) => agent.id === onDisk.default_agent,
      ),
    ).toHaveLength(1)

    const before = await readFile(projectMetaPath(workspace, projectId), "utf8")
    const missing = errorOf(
      await setDefaultAgent({ workspace, projectId, id: "ghost-000000" }),
    )
    expect(missing.kind).toBe("not-found")
    expect(await readFile(projectMetaPath(workspace, projectId), "utf8")).toBe(before)

    // Clearing is explicit and leaves the project without a default.
    expect(unwrap(await setDefaultAgent({ workspace, projectId, id: "" }))).toEqual({
      defaultAgent: "",
    })
    expect((await meta()).default_agent).toBe("")
  })

  test("renaming an agent keeps its id", async () => {
    const agent = unwrap(await createAgent({ workspace, projectId, name: "Original" }))
    const renamed = unwrap(
      await updateAgent({
        workspace,
        projectId,
        id: agent.id,
        patch: { name: "Renamed", model: "anthropic/claude-sonnet-4-5" },
      }),
    )
    expect(renamed.id).toBe(agent.id)
    expect(unwrap(await getAgent(workspace, projectId, agent.id)).name).toBe("Renamed")
    expect((await meta()).agents).toMatchObject([{ id: agent.id, name: "Renamed" }])
  })

  test("deleting the default agent leaves no default and blocks project chat", async () => {
    const agent = unwrap(await createAgent({ workspace, projectId, name: "Only" }))
    unwrap(await setDefaultAgent({ workspace, projectId, id: agent.id }))

    const deleted = unwrap(await deleteAgent({ workspace, projectId, id: agent.id }))
    expect(deleted.defaultCleared).toBe(true)
    const onDisk = await meta()
    expect(onDisk.default_agent).toBe("")
    expect(onDisk.agents).toEqual([])

    const engine = (): ChatEngine => ({
      async *send(): AsyncGenerator<ChatEvent> {
        throw new Error("the engine must not be reached")
      },
      cancel() {},
    })
    const stored = JSON.parse(await readFile(projectMetaPath(workspace, projectId), "utf8")) as Record<string, unknown>
    await writeMeta({ ...stored, mode: "swarm" })

    const prepared = await prepareTurn({ workspace, engine }, { projectId, text: "hello" })
    expect(prepared.ok).toBe(false)
    if (prepared.ok) throw new Error("unreachable")
    expect(prepared.error.kind).toBe("blocked")
    expect(prepared.error.message).toBe(NO_DEFAULT_AGENT)
  })

  test("a saved profile that fails validation is reported, not dropped", async () => {
    const stored = await meta()
    await writeMeta({
      ...stored,
      agents: [
        { id: "broken-aaaaaa", name: "Broken", max_tool_calls: 0 },
        { id: "good-bbbbbb", name: "Good", max_tool_calls: 4 },
      ],
      default_agent: "broken-aaaaaa",
    })

    const listed = unwrap(await listAgents(workspace, projectId))
    expect(listed.agents.map((agent) => agent.id)).toEqual(["good-bbbbbb"])
    expect(listed.issues).toHaveLength(1)
    expect(listed.issues[0]).toMatchObject({
      index: 0,
      id: "broken-aaaaaa",
      name: "Broken",
      field: "maxToolCalls",
    })
    expect(listed.issues[0]?.message).toContain("1")

    const invalid = errorOf(await getAgent(workspace, projectId, "broken-aaaaaa"))
    expect(invalid.kind).toBe("invalid-meta")
    expect(invalid.message).toBe(listed.issues[0]?.message ?? "")

    // The repair path: an update validates the merged record.
    const repaired = unwrap(
      await updateAgent({
        workspace,
        projectId,
        id: "broken-aaaaaa",
        patch: { maxToolCalls: 6 },
      }),
    )
    expect(repaired.maxToolCalls).toBe(6)
    expect(unwrap(await listAgents(workspace, projectId)).issues).toEqual([])
  })

  test("unknown keys on a stored profile survive an update", async () => {
    const stored = await meta()
    await writeMeta({
      ...stored,
      agents: [
        { id: "kept-cccccc", name: "Kept", role: "reviewer", status: "idle", extra: { a: 1 } },
      ],
    })

    unwrap(
      await updateAgent({
        workspace,
        projectId,
        id: "kept-cccccc",
        patch: { instructions: "Updated." },
      }),
    )
    const row = (await meta()).agents as Array<Record<string, unknown>>
    expect(row[0]).toMatchObject({
      status: "idle",
      extra: { a: 1 },
      instructions: "Updated.",
    })
  })

  test("ids are slug-hash, stable and collision-checked", () => {
    expect(agentId("Reviewer", ["reviewer-000000"])).toMatch(/^reviewer-[0-9a-f]{6}$/)
    expect(agentId("My app reviewer", [], "my-app")).toMatch(/^my-app-my-app-reviewer-[0-9a-f]{6}$/)
    const first = agentId("Reviewer")
    expect(agentId("Reviewer")).toBe(first)
    expect(agentId("Reviewer", [first])).not.toBe(first)
  })

  test("validateAgent never mutates and defaults are explicit", () => {
    const input = { name: "  Agent  " }
    const validated = unwrap(validateAgent(input))
    expect(validated).toEqual({
      name: "Agent",
      role: "builder",
      instructions: "",
      model: "",
      maxToolCalls: 8,
      allowedTools: [],
      allowWrite: false,
      allowCommand: false,
      template: "",
    })
    expect(input).toEqual({ name: "  Agent  " })
  })
})

describe("templates", () => {
  test("the built-in table is data: reviewer/researcher read-only, implementer write-only", () => {
    expect(BUILT_IN_TEMPLATES.map((template) => template.id)).toEqual([
      "reviewer",
      "implementer",
      "researcher",
    ])
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.allowCommand).toBe(false)
      expect(template.builtin).toBe(true)
    }
    expect(builtInTemplate("reviewer")).toMatchObject({ allowWrite: false })
    expect(builtInTemplate("researcher")).toMatchObject({ allowWrite: false })
    expect(builtInTemplate("implementer")).toMatchObject({ allowWrite: true })
  })

  test("instantiating reviewer yields a read-only profile; implementer may write but not command", async () => {
    const reviewer = unwrap(
      await instantiateTemplate({
        workspace,
        projectId,
        template: "reviewer",
      }),
    )
    expect(reviewer.allowWrite).toBe(false)
    expect(reviewer.allowCommand).toBe(false)
    expect(reviewer.allowedTools.sort()).toEqual([...READ_ONLY_TOOL_NAMES].sort())
    expect(reviewer.template).toBe("reviewer")
    expect(reviewer.id.startsWith("my-app-reviewer-")).toBe(true)

    const implementer = unwrap(
      await instantiateTemplate({ workspace, projectId, template: "implementer" }),
    )
    expect(implementer.allowWrite).toBe(true)
    expect(implementer.allowCommand).toBe(false)
    expect(implementer.template).toBe("implementer")
    expect(effectiveToolNames(implementer).sort()).toEqual([...READ_ONLY_TOOL_NAMES].sort())

    // A fresh id per instantiation, even for the same template.
    const second = unwrap(
      await instantiateTemplate({
        workspace,
        projectId,
        template: "implementer",
        name: "Implementer 2",
      }),
    )
    expect(second.id).not.toBe(implementer.id)
  })

  test("project templates load from work/templates", async () => {
    for (const file of ["doc-reviewer.json", "fixer.json"]) {
      await writeFile(
        join(templatesDir(workspace), file),
        await readFile(join(FIXTURES, file), "utf8"),
      )
    }

    const listed = unwrap(await listTemplates(workspace))
    expect(listed.issues).toEqual([])
    expect(listed.templates.map((template) => template.id)).toEqual([
      "reviewer",
      "implementer",
      "researcher",
      "doc-reviewer",
      "fixer",
    ])
    expect(listed.templates.find((template) => template.id === "doc-reviewer")).toMatchObject({
      name: "Doc reviewer",
      allowWrite: false,
      allowCommand: false,
      maxToolCalls: 6,
      builtin: false,
    })
  })

  test("a project template that requests allowCommand is refused on instantiation", async () => {
    await writeFile(
      join(templatesDir(workspace), "fixer.json"),
      await readFile(join(FIXTURES, "fixer.json"), "utf8"),
    )

    const refused = errorOf(
      await instantiateTemplate({ workspace, projectId, template: "fixer" }),
    )
    expect(refused.kind).toBe("template")
    expect(refused.message).toContain("command")
    expect((await meta()).agents).toHaveLength(0)

    // The same template is still listed so the user can fix it by hand.
    expect(
      unwrap(await listTemplates(workspace)).templates.some((entry) => entry.id === "fixer"),
    ).toBe(true)
  })

  test("an unknown template id is a typed error", async () => {
    expect(errorOf(await instantiateTemplate({ workspace, projectId, template: "ghost" })).kind).toBe(
      "not-found",
    )
  })

  test("instantiation cannot grant command access through overrides", async () => {
    const refused = errorOf(
      await instantiateTemplate({
        workspace,
        projectId,
        template: "implementer",
        overrides: { allowCommand: true } as never,
      }),
    )
    expect(refused.kind).toBe("invalid-input")
    expect(refused).toMatchObject({ field: "allowCommand" })
  })

  test("a broken template file is reported, not silently skipped", async () => {
    await writeFile(join(templatesDir(workspace), "broken.json"), "{ not json")
    const listed = unwrap(await listTemplates(workspace))
    expect(listed.templates).toHaveLength(BUILT_IN_TEMPLATES.length)
    expect(listed.issues).toHaveLength(1)
    expect(listed.issues[0]?.file).toBe("broken.json")
    expect(listed.issues[0]?.message).toContain("JSON")
  })

  test("saving a profile as a project template round-trips and refuses built-in ids", async () => {
    const agent = unwrap(
      await createAgent({
        workspace,
        projectId,
        name: "Snapshot",
        role: "reviewer",
        allowedTools: ["list_files"],
        allowWrite: false,
      }),
    )
    const saved = unwrap(
      await saveProjectTemplate({ workspace, agent, name: "snapshot-review" }),
    )
    expect(saved.id).toBe("snapshot-review")

    const listed = unwrap(await listTemplates(workspace))
    expect(listed.templates.find((template) => template.id === "snapshot-review")).toEqual(saved)

    expect(
      errorOf(await saveProjectTemplate({ workspace, agent, name: "reviewer" })).kind,
    ).toBe("template")
  })
})

describe("swarm boundary", () => {
  test("forSwarm(implementer) is read-only, command-free and keeps only read-only tools", async () => {
    const implementer = unwrap(
      await instantiateTemplate({ workspace, projectId, template: "implementer" }),
    )
    expect(implementer.allowWrite).toBe(true)

    const worker = forSwarm(implementer)
    expect(worker.allowWrite).toBe(false)
    expect(worker.allowCommand).toBe(false)
    expect([...worker.allowedTools].sort()).toEqual([...READ_ONLY_TOOL_NAMES].sort())

    // The stored profile is untouched: the copy is a value.
    expect(implementer.allowWrite).toBe(true)
    expect(unwrap(await getAgent(workspace, projectId, implementer.id)).allowWrite).toBe(true)
  })

  test("forSwarm never narrows a hand-written write/command tool name into the copy", () => {
    const profile: AgentProfile = {
      id: "x-000000",
      name: "X",
      role: "builder",
      instructions: "",
      model: "",
      maxToolCalls: 8,
      allowedTools: ["list_files", "write_file", "run_command"],
      allowWrite: true,
      allowCommand: true,
      template: "",
    }
    const worker = forSwarm(profile)
    expect(worker.allowedTools).toEqual(["list_files"])
    expect(worker.allowWrite).toBe(false)
    expect(worker.allowCommand).toBe(false)
  })
})

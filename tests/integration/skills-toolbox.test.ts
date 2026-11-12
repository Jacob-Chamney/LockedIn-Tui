/**
 * WP-406 — the skills toolbox against a real goal folder.
 *
 * The goal and its sources are built through WP-401/WP-402, so the toolbox sees
 * exactly the meta.json a real session produces.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { gatherSources } from "../../src/services/skills/gather";
import { createSkillsToolbox, type SkillsToolError } from "../../src/services/skills/toolbox";
import { skillTools } from "../../src/app/actions/skills";
import { buildPdf } from "../unit/helpers/ooxml";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

/**
 * PDF extraction needs `pdftotext` (poppler). Without it these assertions fail
 * with a product-looking error on a machine that is simply missing a host tool,
 * so they skip with a reason — never a silent pass. Declared in
 * `docs/testing.md` §1.
 */
const PDF_TOOL = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })
if (!PDF_TOOL) {
  console.warn(
    "SKIP (pdf): pdftotext not found — install poppler (apt install poppler-utils / brew install poppler)",
  )
}
const pdfTest = PDF_TOOL ? test : test.skip
const CREATED = "2026-11-01T14:30:00.000Z"
const STAGES: StageDraft[] = [
  { title: "Registers", milestone: "explain a stack frame" },
  { title: "Control flow", milestone: "trace a loop" },
  { title: "Conventions", milestone: "read a prologue" },
]

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, SkillsToolError>): SkillsToolError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let goalId: string
let goalFolder: string
let inputs: string

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "skills-toolbox-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  inputs = join(base, "input")
  await mkdir(inputs, { recursive: true })

  const saved = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(
        validateInput({ statement: "read disassembly", level: "beginner", timeBudget: "6 weeks" }),
      ),
      stages: STAGES,
      created: CREATED,
    }),
  )
  goalId = saved.goal.id
  goalFolder = saved.folder

  await writeFile(join(inputs, "intel.pdf"), buildPdf())
  await writeFile(join(inputs, "notes.md"), "# Registers\n\nRegisters hold working state across calls.\n")

  unwrap(
    await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
      { kind: "file", path: join(inputs, "notes.md") },
      { kind: "text", name: "gathered", text: "A loop branches back to its head.", origin: "agent-gathered" },
      { kind: "file", path: join(inputs, "intel.pdf") },
    ]),
  )
})

afterEach(async () => {
  await removeTemp(base)
})

function toolbox() {
  return createSkillsToolbox({ workspace, goalId })
}

describe("listing", () => {
  test("lists every source with kind, size, origin and its saved excerpt", async () => {
    const listed = unwrap(await toolbox().tools.listSources())
    expect(listed).toHaveLength(3)

    const gathered = listed.find((entry) => entry.name === "gathered.md")!
    expect(gathered.origin).toBe("agent-gathered")
    expect(gathered.excerpt).toContain("A loop branches back")

    for (const entry of listed) {
      expect(entry.hash).toStartWith("sha256:")
      expect(entry.bytes).toBeGreaterThan(0)
      expect(entry).not.toHaveProperty("path")
      expect(entry).not.toHaveProperty("storedPath")
    }
  })

  test("the origin label survives: a user file is not agent-gathered", async () => {
    const listed = unwrap(await toolbox().tools.listSources())
    expect(listed.find((entry) => entry.name === "notes.md")?.origin).toBe("user")
  })
})

describe("reading", () => {
  test("a markdown source returns its text with label, hash, bytes and excerpt", async () => {
    const read = unwrap(await toolbox().tools.readSource("notes.md"))
    expect(read.kind).toBe("markdown")
    expect(read.origin).toBe("user")
    expect(read.text).toContain("Registers hold working state")
    expect(read.hash).toStartWith("sha256:")
    expect(read.bytes).toBeGreaterThan(0)
    expect(read.excerpt).toContain("Registers hold working state")
    expect(read.truncated).toBe(false)
  })

  pdfTest("a pdf is read through the extraction service, not as binary text", async () => {
    const read = unwrap(await toolbox().tools.readSource("intel.pdf"))
    expect(read.kind).toBe("pdf")
    expect(read.text).toContain("LockedIn source pipeline")
    expect(read.text).not.toContain("%PDF")
  })

  test("an unknown name is a typed missing error", async () => {
    const error = errorOf(await toolbox().tools.readSource("absent.md"))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("missing")
  })
})

describe("refusals", () => {
  test("a school path is refused and no bytes are read", async () => {
    const schoolFile = join(workspace.paths.schoolVault, "concepts", "energy.md")
    await mkdir(join(workspace.paths.schoolVault, "concepts"), { recursive: true })
    await writeFile(schoolFile, "SCHOOL ONLY MATERIAL")

    const tried = [
      schoolFile,
      "../".repeat(4) + "school/vault/concepts/energy.md",
      "sources/../../../school/vault/concepts/energy.md",
    ]
    for (const name of tried) {
      const error = errorOf(await toolbox().tools.readSource(name))
      expect(error.kind).toBe("path")
      if (error.kind !== "path") continue
      expect(["escape", "missing"]).toContain(error.reason)
      expect(JSON.stringify(error)).not.toContain("SCHOOL ONLY MATERIAL")
    }
  })

  test("a traversal name is refused", async () => {
    const error = errorOf(await toolbox().tools.readSource("../../meta.json"))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("missing")
  })
  test("a meta stored path cannot escape the goal's sources", async () => {
    const secret = join(workspace.root, "SECRET-OUTSIDE.toolbox.txt")
    await writeFile(secret, "SECRET-OUTSIDE-CONTENT\n")
    const metaPath = join(goalFolder, "meta.json")
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as { sources: Array<Record<string, unknown>> }
    meta.sources.push({
      name: "leak.txt",
      storedPath: "sources/../../../../SECRET-OUTSIDE.toolbox.txt",
      hash: `sha256:${"a".repeat(64)}`,
      kind: "text",
      origin: "user",
      excerpt: null,
      unusable: false,
      reason: null,
    })
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`)

    for (const call of [
      () => toolbox().tools.listSources(),
      () => toolbox().tools.searchSources("SECRET-OUTSIDE"),
      () => toolbox().tools.readSource("leak.txt"),
    ]) {
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error.kind).toBe("path")
      if (result.error.kind !== "path") continue
      expect(result.error.reason).toBe("escape")
      expect(JSON.stringify(result.error)).not.toContain("SECRET-OUTSIDE-CONTENT")
    }
  })

  test("a malformed source entry is a typed error, not a throw", async () => {
    const metaPath = join(goalFolder, "meta.json")
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as { sources: Array<Record<string, unknown>> }
    meta.sources.push({ name: "broken.txt" })
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`)

    const error = errorOf(await toolbox().tools.listSources())
    expect(error.kind).toBe("storage")
  })

  test("a missing goal is a typed error", async () => {
    const box = createSkillsToolbox({ workspace, goalId: "no-such-goal" })
    const error = errorOf(await box.tools.listSources())
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.message).toContain("no-such-goal")
    expect(error.next).toContain("skill session")
  })

  test("an archived goal is refused with the restore step", async () => {
    const metaPath = join(goalFolder, "meta.json")
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>
    await writeFile(metaPath, `${JSON.stringify({ ...meta, archived: true }, null, 2)}\n`)

    const calls: Array<() => Promise<Result<unknown, SkillsToolError>>> = [
      () => toolbox().tools.listSources(),
      () => toolbox().tools.readSource("notes.md"),
      () => toolbox().tools.searchSources("registers"),
    ]
    for (const call of calls) {
      const error = errorOf(await call())
      expect(error.kind).toBe("blocked")
      if (error.kind !== "blocked") continue
      expect(error.next).toContain("restore")
    }
  })
})

describe("searching", () => {
  test("findings carry the label and the excerpt", async () => {
    const result = unwrap(await toolbox().tools.searchSources("loop"))
    expect(result.hits.length).toBeGreaterThan(0)
    const [hit] = result.hits
    expect(hit?.name).toBe("gathered.md")
    expect(hit?.origin).toBe("agent-gathered")
    expect(hit?.excerpt).toContain("A loop branches back")
    expect(hit?.line).toBe(1)
    expect(hit?.snippet).toContain("loop")
  })

  pdfTest("search is case-insensitive and covers a pdf through extraction", async () => {
    const lower = unwrap(await toolbox().tools.searchSources("registers"))
    const upper = unwrap(await toolbox().tools.searchSources("REGISTERS"))
    expect(upper.hits).toEqual(lower.hits)

    const pdf = unwrap(await toolbox().tools.searchSources("boundary"))
    expect(pdf.hits.some((hit) => hit.name === "intel.pdf")).toBe(true)
  })

  test("an empty term returns nothing", async () => {
    expect(unwrap(await toolbox().tools.searchSources(""))).toEqual({
      hits: [],
      total: 0,
      truncated: false,
    })
  })
})

describe("isolation", () => {
  test("only this goal's sources are visible", async () => {
    const other = unwrap(
      await saveGoal({
        workspace,
        input: unwrap(validateInput({ statement: "another goal", level: "advanced", timeBudget: "2 weeks" })),
        stages: STAGES,
        created: CREATED,
        takenIds: [goalId],
      }),
    )
    unwrap(
      await gatherSources({ workspace, goalId: other.goal.id, retrievedAt: CREATED }, [
        { kind: "text", name: "private", text: "Only the other goal can see this." },
      ]),
    )

    expect(unwrap(await toolbox().tools.listSources())).toHaveLength(3)
    expect(errorOf(await toolbox().tools.readSource("private.md")).kind).toBe("path")
  })
})

describe("the chat tool source", () => {
  test("context flattens this goal's sources and labels the origin", async () => {
    const tools = skillTools({ workspace, goalId })
    const context = await tools.context()
    expect(context).toContain("Registers hold working state")
    expect(context).toContain("A loop branches back")
    expect(context).toContain("agent-gathered")
    expect(context).toContain("(agent explanation)")
  })

  test("resolveTool is bound to the goal's sources", async () => {
    const tools = skillTools({ workspace, goalId })
    const listed = JSON.parse(await tools.resolveTool("list_sources", {})) as {
      ok: boolean
      value?: Array<{ name: string }>
    }
    expect(listed.ok).toBe(true)
    expect(listed.value?.map((entry) => entry.name)).toContain("notes.md")

    const read = JSON.parse(await tools.resolveTool("read_source", { name: "notes.md" })) as {
      ok: boolean
      value?: { text: string }
    }
    expect(read.ok).toBe(true)
    expect(read.value?.text).toContain("Registers")
  })
})

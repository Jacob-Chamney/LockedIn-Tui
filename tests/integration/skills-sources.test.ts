/**
 * WP-402 — gathering sources into a real goal folder.
 *
 * A goal is created through WP-401's save path, so `meta.json` is the real
 * shape. Network is injected; nothing here touches a URL.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { fetchWebText, gatherSources, isBlockedAddress, requestPinned, type GatherInput, type SkillSource } from "../../src/services/skills/gather";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
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

function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let goalId: string
let goalFolder: string
let inputsDir: string

async function sources(): Promise<SkillSource[]> {
  const meta = JSON.parse(await readFile(join(goalFolder, "meta.json"), "utf8")) as {
    sources: SkillSource[]
  }
  return meta.sources
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "skills-sources-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  inputsDir = join(base, "input")
  await mkdir(inputsDir, { recursive: true })

  const saved = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(
        validateInput({ statement: "read disassembly output", level: "beginner", timeBudget: "6 weeks" }),
      ),
      stages: STAGES,
      created: CREATED,
    }),
  )
  goalId = saved.goal.id
  goalFolder = saved.folder
})

afterEach(async () => {
  await removeTemp(base)
})

describe("the three accepted inputs", () => {
  test("a local markdown file, pasted text and a URL each become one source", async () => {
    await writeFile(join(inputsDir, "intel.md"), "# Intel SDM\n\nRegisters hold working state and survive calls.\n")

    const outcome = unwrap(
      await gatherSources(
        {
          workspace,
          goalId,
          retrievedAt: CREATED,
          fetchText: async () => "<h1>Control flow</h1><p>A loop branches back.</p>",
        },
        [
          { kind: "file", path: join(inputsDir, "intel.md") },
          { kind: "text", name: "note", text: "The stack grows downward on x86-64." },
          { kind: "url", url: "https://example.test/control-flow", origin: "agent-gathered" },
        ],
      ),
    )

    expect(outcome.added).toBe(3)
    expect(outcome.sources.map((source) => source.kind)).toEqual(["markdown", "markdown", "web"])
    expect(outcome.sources.map((source) => source.origin)).toEqual([
      "user",
      "user",
      "agent-gathered",
    ])

    for (const source of outcome.sources) {
      expect(source.hash).toStartWith("sha256:")
      expect(source.retrievedAt).toBe(CREATED)
      expect(source.storedPath.startsWith("sources/")).toBe(true)
      expect(source.storedPath).not.toContain(base)
      expect(source.excerpt?.text.length ?? 0).toBeLessThanOrEqual(400)
      expect(source.unusable).toBe(false)
    }
  })

  test.skipIf(process.platform === "win32")("a special file is refused instead of blocking the copy", async () => {
    const pipe = join(inputsDir, "pipe.md")
    const made = Bun.spawnSync({ cmd: ["mkfifo", pipe], stdout: "pipe", stderr: "pipe" })
    expect(made.exitCode).toBe(0)

    const error = errorOf(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "file", path: pipe },
      ]),
    )
    expect(error.kind).toBe("unsupported")
    if (error.kind !== "unsupported") return
    expect(error.message).toContain("not a regular file")
  })

  test("every stored path is relative and exists inside sources/", async () => {
    const outcome = unwrap(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "text", name: "note", text: "Registers are the working state." },
      ]),
    )
    for (const source of outcome.sources) {
      expect(existsSync(join(goalFolder, source.storedPath))).toBe(true)
      expect(await readdir(join(goalFolder, "sources"))).toContain(
        source.storedPath.replace("sources/", ""),
      )
    }
  })

  test("the same content added twice adds one source and reports the duplicate", async () => {
    const first = unwrap(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "text", name: "note", text: "Registers are the working state." },
      ]),
    )
    expect(first.added).toBe(1)

    const second = unwrap(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "text", name: "note", text: "Registers are the working state." },
        { kind: "text", name: "other", text: "A different fact entirely." },
      ]),
    )
    expect(second.added).toBe(1)
    expect(second.duplicates).toBe(1)
    expect(second.skipped).toEqual(["note.md"])
    expect(await sources()).toHaveLength(2)
  })
})

describe("unusable sources stay visible", () => {
  test("four characters is citable, three is not", async () => {
    const outcome = unwrap(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED, excerptChars: 400 }, [
        { kind: "text", name: "tiny", text: "ab" },
      ]),
    )
    const [source] = outcome.sources
    expect(source?.unusable).toBe(true)
    expect(source?.excerpt).toBeNull()
    expect(source?.reason).toBe("not enough text to cite")
    // It is recorded, so the user can see it and cannot cite it by accident.
    expect(await sources()).toHaveLength(1)
  })

  test("a file that cannot be extracted keeps the copy and a reason", async () => {
    await writeFile(join(inputsDir, "broken.pdf"), "not a pdf at all\n")
    const outcome = unwrap(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED, excerptChars: 400 }, [
        { kind: "file", path: join(inputsDir, "broken.pdf") },
      ]),
    )
    const [source] = outcome.sources
    expect(source?.unusable).toBe(true)
    expect(source?.reason).not.toBeNull()
    expect(existsSync(join(goalFolder, source!.storedPath))).toBe(true)
  })
})

describe("network failure", () => {
  test("a failed fetch is one network error and leaves previous sources identical", async () => {
    unwrap(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "text", name: "kept", text: "Registers are the working state." },
      ]),
    )
    const before = await readFile(join(goalFolder, "meta.json"), "utf8")

    const error = errorOf(
      await gatherSources(
        {
          workspace,
          goalId,
          retrievedAt: CREATED,
          fetchText: async () => {
            throw new Error("getaddrinfo ENOTFOUND")
          },
        },
        [{ kind: "url", url: "https://example.test/down" }],
      ),
    )
    expect(error.kind).toBe("network")
    if (error.kind !== "network") return
    expect(error.message).toContain("example.test/down")
    expect(error.next).toContain("other sources are untouched")
    expect(await readFile(join(goalFolder, "meta.json"), "utf8")).toBe(before)
  })
})

describe("a damaged goal", () => {
  test("a meta.json with a non-object source is a typed storage error", async () => {
    await writeFile(join(goalFolder, "meta.json"), JSON.stringify({ id: goalId, sources: [null] }))
    const error = errorOf(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "text", name: "kept", text: "Registers are the working state." },
      ]),
    )
    expect(error.kind).toBe("storage")
    if (error.kind !== "storage") return
    expect(error.message).toContain("invalid source")
  })
})

describe("a batch that cannot finish", () => {
  test("a later missing input leaves no untracked copies from earlier items", async () => {
    const error = errorOf(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "text", name: "kept", text: "Registers are the working state." },
        { kind: "file", path: join(inputsDir, "missing.md") },
      ]),
    )
    expect(error.kind).toBe("path")
    expect(await sources()).toEqual([])
    expect(existsSync(join(goalFolder, "sources")) ? await readdir(join(goalFolder, "sources")) : []).toEqual([])
  })
})

describe("cancellation", () => {
  test("cancelling a five-item batch after three keeps three and writes meta once", async () => {
    const writes: number[] = []
    const batch: GatherInput[] = Array.from({ length: 5 }, (_, index) => ({
      kind: "text" as const,
      name: `note-${index}`,
      text: `Fact number ${index} about registers and stacks.`,
    }))

    // The predicate is asked once before each item: three checks pass, the
    // fourth cancels, so exactly three are gathered.
    let checks = 0
    const outcome = unwrap(
      await gatherSources(
        {
          workspace,
          goalId,
          retrievedAt: CREATED,
          cancelled: () => checks++ >= 3,
          onMetaWrite: () => writes.push(Date.now()),
        },
        batch,
      ),
    )

    expect(outcome.cancelled).toBe(true)
    expect(outcome.added).toBe(3)
    expect(writes).toHaveLength(1)

    const stored = await sources()
    expect(stored).toHaveLength(3)
    expect(stored.map((source) => source.name)).toEqual(["note-0.md", "note-1.md", "note-2.md"])
    expect(await readdir(join(goalFolder, "sources"))).toHaveLength(3)
  })

  test("a cancelled batch still leaves a readable meta.json", async () => {
    const outcome = unwrap(
      await gatherSources(
        { workspace, goalId, retrievedAt: CREATED, cancelled: () => true },
        [{ kind: "text", name: "never", text: "This should not be gathered." }],
      ),
    )
    expect(outcome.cancelled).toBe(true)
    expect(outcome.added).toBe(0)
    expect(await sources()).toEqual([])
    const meta = JSON.parse(await readFile(join(goalFolder, "meta.json"), "utf8")) as { id: string }
    expect(meta.id).toBe(goalId)
  })
})

describe("the wall", () => {
  test("a school-side path is refused before any read or copy", async () => {
    const schoolFile = join(workspace.paths.schoolVault, "concepts", "energy.md")
    await mkdir(join(workspace.paths.schoolVault, "concepts"), { recursive: true })
    await writeFile(schoolFile, "school material\n")

    const before = await sources()
    const error = errorOf(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "file", path: schoolFile },
      ]),
    )
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("escape")
    // Nothing was recorded and nothing was copied.
    expect(await sources()).toEqual(before)
    expect(existsSync(join(goalFolder, "sources", "energy.md"))).toBe(false)
  })
})

describe("web fetches stay on the public web", () => {
  test("private, loopback and link-local addresses are refused", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
      "2002:7f00:1::1",
    ]) {
      expect(isBlockedAddress(address)).toBe(true)
    }
    for (const address of ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address)).toBe(false)
    }
  })

  test("a request uses the checked address, not a second DNS answer", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("pinned body") })
    try {
      const response = await requestPinned(
        `http://example.test:${server.port}/source`,
        { address: "127.0.0.1", family: 4 },
        Date.now() + 5_000,
      )
      expect(response.status).toBe(200)
      expect(response.text).toBe("pinned body")
    } finally {
      server.stop(true)
    }
  })

  test("the default fetch refuses loopback, credentials and non-HTTP URLs", async () => {
    for (const url of [
      "http://127.0.0.1:9/source",
      "http://localhost:9/source",
      "http://[::1]:9/source",
      "https://user:pass@example.test/source",
      "file:///etc/passwd",
    ]) {
      await expect(fetchWebText(url)).rejects.toThrow()
    }
  })

  test("a URL source keeps the typed network error and writes nothing", async () => {
    const before = await sources()
    const error = errorOf(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "url", url: "http://127.0.0.1:9/private" },
      ]),
    )
    expect(error.kind).toBe("network")
    if (error.kind !== "network") return
    expect(error.message).toContain("127.0.0.1:9/private")
    expect(await sources()).toEqual(before)
  })
})

describe("round trip", () => {
  test("an excerpt survives the source note's frontmatter", async () => {
    unwrap(
      await gatherSources({ workspace, goalId, retrievedAt: CREATED }, [
        { kind: "text", name: "note", text: "Registers hold working state across calls." },
      ]),
    )
    const [source] = await sources()
    expect(source?.excerpt).toEqual({
      sourceName: "note.md",
      location: source!.storedPath,
      hash: expect.any(String),
      text: "Registers hold working state across calls.",
    })
    // The stored copy still holds the text the excerpt came from.
    const stored = await readFile(join(goalFolder, source!.storedPath), "utf8")
    expect(stored).toContain("Registers hold working state")
  })
})

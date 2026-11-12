/** The plugin runtime connects, lists and exposes only read-only tools. */
import { afterEach, expect, test } from "bun:test"
import { join } from "node:path"

import { createPluginRuntime, type PluginRuntime } from "../../src/app/actions/plugins"

const SERVER = join(import.meta.dir, "..", "fixtures", "plugins", "server.ts")
let runtime: PluginRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

function make(enabled = true): PluginRuntime {
  return createPluginRuntime([
    { id: "notes", command: process.execPath, args: [SERVER], enabled },
  ])
}

test("start connects and lists tools; the pane rows are real", async () => {
  runtime = make()
  await runtime.start()
  const rows = runtime.rows()
  expect(rows).toHaveLength(1)
  expect(rows[0]?.status).toBe("connected")
  expect(rows[0]?.tools.map((tool) => tool.name).sort()).toEqual([
    "read_note",
    "slow_tool",
    "write_note",
  ])
  expect(rows[0]?.tools.find((tool) => tool.name === "write_note")?.write).toBe(true)
})

test("a disabled server is not started", async () => {
  runtime = make(false)
  await runtime.start()
  const rows = runtime.rows()
  expect(rows[0]?.status).toBe("stopped")
  expect(rows[0]?.enabled).toBe(false)
})

test("chill gets only the read-only tools; lock-in gets none", async () => {
  runtime = make()
  await runtime.start()
  const chill = runtime.sourceFor("chill")
  if (chill === null) throw new Error("expected chill tools")
  expect(chill.specs.map((spec) => spec.name).sort()).toEqual(["read_note", "slow_tool"])

  const text = await chill.resolveTool("read_note", { path: "concepts/a.md" })
  expect(text).toContain("concepts/a.md")
  expect(runtime.sourceFor("lockin")).toBeNull()
})

test("lock-in exposes plugins only when the turn is explicit (learning-web)", async () => {
  runtime = make()
  await runtime.start()
  expect(runtime.sourceFor("lockin")).toBeNull()
  const explicit = runtime.sourceFor("lockin", { explicitCall: true })
  if (explicit === null) throw new Error("expected explicit lock-in tools")
  expect(explicit.specs.map((spec) => spec.name).sort()).toEqual(["read_note", "slow_tool"])
  // The spec being offered is not enough: the call itself must be allowed.
  const text = await explicit.resolveTool("read_note", { path: "concepts/a.md" })
  expect(text).toContain("concepts/a.md")
  expect(text).not.toContain("denied")
})

test("the core web server is available to work and skill by default", async () => {
  runtime = createPluginRuntime([
    { id: "web-search", command: process.execPath, args: [SERVER], enabled: true, core: true },
  ])
  await runtime.start()
  const work = runtime.sourceFor("work")
  const skill = runtime.sourceFor("skill")
  if (work === null || skill === null) throw new Error("expected core web tools")
  expect(work.specs.map((spec) => spec.name).sort()).toEqual(["read_note", "slow_tool"])
  expect(work.specs.every((spec) => spec.web === true)).toBe(true)
  expect(skill.specs.every((spec) => spec.web === true)).toBe(true)
  // Lock-in must still not reach the web without `learning-web`.
  expect(runtime.sourceFor("lockin")).toBeNull()
})

test("a user-disabled core web server stays off everywhere", async () => {
  runtime = createPluginRuntime([
    { id: "web-search", command: process.execPath, args: [SERVER], enabled: false, core: true },
  ])
  await runtime.start()
  expect(runtime.rows()[0]?.status).toBe("stopped")
  expect(runtime.sourceFor("work")).toBeNull()
  expect(runtime.sourceFor("skill")).toBeNull()
})

test("setEnabled starts and stops without recreating the host", async () => {
  runtime = make(false)
  await runtime.start()
  await runtime.setEnabled("notes", true)
  expect(runtime.rows()[0]?.status).toBe("connected")
  await runtime.setEnabled("notes", false)
  expect(runtime.rows()[0]?.status).toBe("stopped")
})

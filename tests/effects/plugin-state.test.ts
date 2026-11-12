import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  PLUGIN_STORE_MAX_BYTES,
  PluginStateStore,
  sanitizeStore,
  storeBytes,
} from "../../src/ui/plugins/plugin-state"

const dirs: string[] = []

async function store(): Promise<{ state: PluginStateStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "lockedin-plugin-state-"))
  dirs.push(root)
  return { state: new PluginStateStore(root), root }
}

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

test("state round-trips through one file per plugin", async () => {
  const { state } = await store()
  expect(await state.save("lab.status", { visible: false, count: 3, label: "hi", gone: null })).toEqual({
    ok: true,
  })
  expect(await state.load("lab.status")).toEqual({
    visible: false,
    count: 3,
    label: "hi",
    gone: null,
  })
  expect(await state.load("missing.plugin")).toEqual({})
})

test("invalid values and keys are dropped, not stored", () => {
  expect(
    sanitizeStore({
      ok: 1,
      "bad key": 2,
      nested: { a: 1 },
      list: [1],
      nan: Number.NaN,
      yes: true,
      none: null,
    }),
  ).toEqual({ ok: 1, yes: true, none: null })
})

test("an oversized store is refused", async () => {
  const { state } = await store()
  const big = { blob: "x".repeat(PLUGIN_STORE_MAX_BYTES) }
  expect(storeBytes(big)).toBeGreaterThan(PLUGIN_STORE_MAX_BYTES)
  const result = await state.save("lab.status", big)
  expect(result.ok).toBe(false)
})

test("an invalid plugin id is refused", async () => {
  const { state } = await store()
  expect((await state.save("../escape", { a: 1 })).ok).toBe(false)
  expect(await state.load("../escape")).toEqual({})
})

test("scheduled writes flush together", async () => {
  const { state } = await store()
  state.schedule("lab.status", { visible: true }, 10)
  state.schedule("lab.other", { count: 2 }, 10)
  await state.flush()
  expect(await state.load("lab.status")).toEqual({ visible: true })
  expect(await state.load("lab.other")).toEqual({ count: 2 })
})

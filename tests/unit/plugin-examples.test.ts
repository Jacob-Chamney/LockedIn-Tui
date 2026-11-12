import { expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  exampleRowLabel,
  moveExampleCursor,
  PLUGIN_EXAMPLES,
  selectedExample,
} from "../../src/ui/settings/plugin-examples"

const ROOT = join(import.meta.dir, "..", "..", "src", "ui", "effects", "examples")

test("every gallery entry matches its shipped manifest", async () => {
  for (const entry of PLUGIN_EXAMPLES) {
    const manifest = JSON.parse(
      await readFile(join(ROOT, entry.dir, "manifest.json"), "utf8"),
    ) as { id: string; name: string; entry: string }
    expect(manifest.id).toBe(entry.id)
    expect(manifest.name).toBe(entry.name)
    expect(manifest.entry).toBe("effect.ts")
    expect(entry.description.length).toBeGreaterThan(30)
    expect(entry.command).toBe(
      `bun run plugin:build src/ui/effects/examples/${entry.dir} --out plugins`,
    )
  }
})

test("every scene example directory is in the gallery", async () => {
  const dirs = (await readdir(ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("scene-"))
    .map((entry) => entry.name)
    .sort()
  expect(PLUGIN_EXAMPLES.map((entry) => entry.dir).sort()).toEqual(dirs)
})

test("the example cursor clamps and names rows", () => {
  expect(moveExampleCursor(0, 1)).toBe(1)
  expect(moveExampleCursor(0, 50)).toBe(PLUGIN_EXAMPLES.length - 1)
  expect(moveExampleCursor(2, -50)).toBe(0)
  expect(selectedExample(0)).toBe(PLUGIN_EXAMPLES[0]!)
  expect(exampleRowLabel(PLUGIN_EXAMPLES[0]!)).toContain(PLUGIN_EXAMPLES[0]!.id)
})

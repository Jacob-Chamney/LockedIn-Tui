import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { renderApiReference } from "../../scripts/api-reference"

const ROOT = join(import.meta.dir, "..", "..")

test("the SDK reference covers every exported name", async () => {
  const source = await readFile(join(ROOT, "sdk", "index.ts"), "utf8")
  const page = renderApiReference(source)
  const names = [...source.matchAll(/^export (?:function|type|const) (\w+)/gm)].map(
    (match) => match[1]!,
  )
  expect(names.length).toBeGreaterThan(30)
  for (const name of names) expect(page).toContain(name)
})

test("the committed wiki page is current", async () => {
  const page = join(ROOT, "wiki", "API-Reference.md")
  // The public source repository has no wiki checkout; the overlay keeps the
  // generated page and this test guards it there.
  if (!(await Bun.file(page).exists())) return
  const source = await readFile(join(ROOT, "sdk", "index.ts"), "utf8")
  expect(await readFile(page, "utf8")).toBe(renderApiReference(source))
})

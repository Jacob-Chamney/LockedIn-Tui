import { afterAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { bundledPluginRoots, effectPathsFromEnv, loadEffectFile, loadEffectFiles, scanPluginDirs, watchEffectSources } from "../../src/ui/effects/loader"

const dirs: string[] = []

async function fixture(name: string, source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lockedin-effect-"))
  dirs.push(dir)
  const path = join(dir, name)
  await writeFile(path, source)
  return path
}

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

test("a user file is imported and validated", async () => {
  const path = await fixture(
    "ok.ts",
    `export default {
      id: "user.wave",
      maxParticles: 8,
      spawnRate: 4,
      spawn() { return true },
    }`,
  )
  const loaded = await loadEffectFile(path)
  expect("error" in loaded).toBe(false)
  if (!("error" in loaded)) expect(loaded.system.id).toBe("user.wave")
})

test("a named export also works", async () => {
  const path = await fixture("named.ts", `export const system = { id: "user.named", spawn() { return true } }`)
  const loaded = await loadEffectFile(path)
  expect("error" in loaded).toBe(false)
  if (!("error" in loaded)) expect(loaded.system.id).toBe("user.named")
})

test("an invalid file reports why it was rejected", async () => {
  const path = await fixture("bad.ts", `export default { id: "" }`)
  const loaded = await loadEffectFile(path)
  expect("error" in loaded).toBe(true)
  if ("error" in loaded) expect(loaded.error).toContain("id must be a non-empty string")
})

test("a file without a system is rejected", async () => {
  const path = await fixture("empty.ts", `export const nothing = 1`)
  const loaded = await loadEffectFile(path)
  expect("error" in loaded).toBe(true)
  if ("error" in loaded) expect(loaded.error).toContain("exports no default system")
})

test("a directory is scanned for .ts files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lockedin-effect-"))
  dirs.push(dir)
  await writeFile(join(dir, "a.ts"), `export default { id: "user.a", spawn() { return true } }`)
  await writeFile(join(dir, "b.ts"), `export default { id: "user.b", spawn() { return true } }`)
  await writeFile(join(dir, "types.d.ts"), `export type Nope = string`)
  const paths = await effectPathsFromEnv({ LOCKEDIN_EFFECTS_DIR: dir })
  expect(paths).toHaveLength(2)
  const loaded = await loadEffectFiles(paths)
  expect(loaded.systems.map((entry) => entry.system.id)).toEqual(["user.a", "user.b"])
  expect(loaded.errors).toEqual([])
})

test("a missing directory is not an error", async () => {
  expect(await effectPathsFromEnv({ LOCKEDIN_EFFECTS_DIR: "/nonexistent/lockedin" })).toEqual([])
})

function waitFor(check: () => boolean, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started > timeout) {
        clearInterval(timer)
        reject(new Error("timed out"))
      }
    }, 25)
  })
}

test("an edit notifies the watcher for a file list", async () => {
  const path = await fixture("watched.ts", `export default { id: "user.watched" }`)
  let changes = 0
  const stop = watchEffectSources({ LOCKEDIN_EFFECTS_FILE: path }, () => changes++, 20)
  try {
    await writeFile(path, `export default { id: "user.watched", maxParticles: 4 }`)
    await waitFor(() => changes > 0)
    expect(changes).toBeGreaterThan(0)
  } finally {
    stop()
  }
})

test("an edit notifies the watcher for a directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lockedin-effect-"))
  dirs.push(dir)
  const path = join(dir, "a.ts")
  await writeFile(path, `export default { id: "user.a" }`)
  let changes = 0
  const stop = watchEffectSources({ LOCKEDIN_EFFECTS_DIR: dir }, () => changes++, 20)
  try {
    await writeFile(path, `export default { id: "user.b" }`)
    await waitFor(() => changes > 0)
    expect(changes).toBeGreaterThan(0)
  } finally {
    stop()
  }
})

test("unrelated files do not notify a file list", async () => {
  const path = await fixture("only.ts", `export default { id: "user.only" }`)
  let changes = 0
  const stop = watchEffectSources({ LOCKEDIN_EFFECTS_FILE: path }, () => changes++, 20)
  try {
    await writeFile(join(path, "..", "noise.ts"), `export default { id: "user.noise" }`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(changes).toBe(0)
  } finally {
    stop()
  }
})

test("no sources means an inert watcher", () => {
  const stop = watchEffectSources({}, () => {
    throw new Error("should not fire")
  })
  expect(typeof stop).toBe("function")
  stop()
})

test("scanPluginDirs finds plugin children and plugin roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "lockedin-scan-"))
  dirs.push(root)
  for (const name of ["a", "b"]) {
    await mkdir(join(root, name), { recursive: true })
    await writeFile(join(root, name, "manifest.json"), "{}")
  }
  await mkdir(join(root, "not-a-plugin"), { recursive: true })
  expect(await scanPluginDirs([root])).toEqual([join(root, "a"), join(root, "b")])
  expect(await scanPluginDirs([join(root, "a")])).toEqual([join(root, "a")])
  expect(await scanPluginDirs([join(root, "missing")])).toEqual([])
})

test("bundled roots find .lockedin plugin folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "lockedin-bundled-"))
  dirs.push(root)
  const plugins = join(root, "plugins")
  await mkdir(join(plugins, "demo.lockedin"), { recursive: true })
  await writeFile(join(plugins, "demo.lockedin", "manifest.json"), "{}")
  expect(await scanPluginDirs([plugins])).toEqual([join(plugins, "demo.lockedin")])
  const executable = join("opt", "lockedin", "lockedin")
  expect(bundledPluginRoots(executable, root)).toContain(join(root, "plugins"))
  expect(bundledPluginRoots(executable, root)).toContain(join(dirname(executable), "plugins"))
})

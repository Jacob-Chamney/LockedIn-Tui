import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { bundlePluginEntry } from "../../src/ui/plugins/loader"
import type { PluginManifest } from "../../src/ui/plugins/sandbox/manifest"
import { SandboxWorkerPlugin } from "../../src/ui/plugins/sandbox/client"
import { crimson } from "../../src/ui/theme/palettes"

const dirs: string[] = []

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

async function bundle(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lockedin-sandbox-worker-"))
  dirs.push(dir)
  const entry = join(dir, "effect.ts")
  await writeFile(entry, source)
  return bundlePluginEntry(entry)
}

function manifest(): PluginManifest {
  return {
    manifestVersion: 1,
    id: "sandbox.worker",
    name: "Worker test",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {
      particles: {
        maxParticles: 8,
        layers: ["around"],
        triggers: ["keypress"],
        spawnRate: 0,
        spawnBurst: 2,
      },
    },
  }
}

const BASIC = `
export default {
  id: "sandbox.worker",
  maxParticles: 8,
  textLayer: "around",
  spawnRate: 0,
  spawnOn: ["keypress"],
  spawnBurst: 2,
  spawn(ctx, out, index) {
    out.x[index] = ctx.cursor.x
    out.y[index] = ctx.cursor.y
    out.life[index] = 1
    out.maxLife[index] = 1
    out.seed[index] = 0.5
    return true
  },
  step(ctx, out, count) {
    for (let i = 0; i < count; i++) out.life[i] -= ctx.dt
  },
  style() { return { glyph: "*", color: "accent", alpha: 0.8 } },
}
`

function waitFor(check: () => boolean, timeout = 4000): Promise<void> {
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
    }, 20)
  })
}

test("a sandboxed effect runs in a worker and returns particles", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(BASIC),
    manifest: manifest(),
    palette: crimson,
  })
  try {
    expect(effect.layer).toBe("around")
    effect.resize(40, 12)
    effect.setCursor(5, 5)
    effect.event({ kind: "keypress", name: "a" })
    effect.update(1 / 60)
    await waitFor(() => effect.particleCount > 0)
    const [first] = effect.particles()
    expect(first?.glyph).toBe("*")
    expect(first?.color?.toInts()[3]).toBe(204)
    expect(effect.failed).toBe(false)
  } finally {
    effect.dispose()
  }
})

test("a hung worker is terminated and quarantined", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(BASIC.replace('step(ctx, out, count) {', 'step(ctx, out, count) { while (true) {}')),
    manifest: manifest(),
    palette: crimson,
    limits: { memoryBytes: 16 * 1024 * 1024, stackBytes: 512 * 1024, loadTimeoutMs: 500, callTimeoutMs: 40 },
  })
  try {
    effect.resize(40, 12)
    effect.setCursor(5, 5)
    effect.event({ kind: "keypress", name: "a" })
    effect.update(1 / 60)
    await waitFor(() => effect.failed)
    expect(effect.failed).toBe(true)
    expect(effect.particles()).toEqual([])
  } finally {
    effect.dispose()
  }
}, 10_000)

test("a bundle that fails to load rejects instead of starting", async () => {
  const error = await SandboxWorkerPlugin.create({
    bundle: await bundle(`export default { id: "sandbox.worker", spawnOn: ["send"] }`),
    manifest: manifest(),
    palette: crimson,
  })
    .then(() => null)
    .catch((value: Error) => value)
  expect(error).toBeInstanceOf(Error)
  expect(String(error)).toContain("trigger")
})

function sceneManifest(): PluginManifest {
  return {
    manifestVersion: 1,
    id: "sandbox.worker",
    name: "Worker scene",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {
      scene: { anchors: ["top-right"], maxNodes: 8, maxText: 80 },
      state: ["mode"],
    },
  }
}

const SCENE = `
export default {
  id: "sandbox.worker",
  compose(ctx) {
    return { nodes: [
      { kind: "text", anchor: "top-right", x: 0, y: 0, text: "mode " + ctx.state.mode },
      { kind: "text", anchor: "top-left", x: 0, y: 0, text: "not granted" },
    ] }
  },
}
`

test("a sandboxed scene returns nodes that the host sanitises", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(SCENE),
    manifest: sceneManifest(),
    palette: crimson,
  })
  try {
    expect(effect.hasScene).toBe(true)
    expect(effect.hasParticles).toBe(false)
    effect.resize(40, 12)
    effect.compose({ mode: "insert", width: 40, height: 12 })
    await waitFor(() => effect.nodes().length > 0)
    const nodes = effect.nodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: "text", anchor: "top-right", text: "mode insert" })
  } finally {
    effect.dispose()
  }
})

test("absolute nodes reach the host when the manifest grants them", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(`
      export default {
        id: "sandbox.worker",
        compose() {
          return { nodes: [{ kind: "text", anchor: "absolute", x: 2, y: 2, text: "abs" }] }
        },
      }
    `),
    manifest: {
      ...sceneManifest(),
      permissions: { scene: { anchors: [], absolute: true, maxNodes: 4, maxText: 40 } },
    },
    palette: crimson,
  })
  try {
    effect.resize(40, 12)
    effect.compose({ mode: "normal", width: 40, height: 12 })
    await waitFor(() => effect.nodes().length > 0)
    expect(effect.nodes()[0]).toMatchObject({ anchor: "absolute", x: 2, y: 2, text: "abs" })
  } finally {
    effect.dispose()
  }
})

test("a command round-trips through the worker", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(`
      export default {
        id: "sandbox.worker",
        commands: { "status-toggle"() { return "toggled" } },
      }
    `),
    manifest: {
      manifestVersion: 1,
      id: "sandbox.worker",
      name: "Command worker",
      version: "1.0.0",
      apiVersion: "1.0",
      entry: "effect.ts",
      permissions: { commands: [{ id: "status-toggle", title: "Toggle", keys: "space+s" }] },
    },
    palette: crimson,
  })
  try {
    expect(effect.commandIds).toEqual(["status-toggle"])
    const results: Array<{ id: string; ok: boolean; message?: string }> = []
    effect.onCommandResult = (result) => results.push(result)
    effect.command("status-toggle", { mode: "normal", width: 40, height: 12 })
    await waitFor(() => results.length > 0)
    expect(results[0]).toEqual({ id: "status-toggle", ok: true, message: "toggled" })
  } finally {
    effect.dispose()
  }
})

test("pointer commands mark their result and stay quiet", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(`
      export default {
        id: "sandbox.worker",
        commands: {
          "cell-click"(ctx) { return "cell " + ctx.pointer.row + ":" + ctx.pointer.column },
          "cell-hover"() {},
        },
      }
    `),
    manifest: {
      manifestVersion: 1,
      id: "sandbox.worker",
      name: "Pointer worker",
      version: "1.0.0",
      apiVersion: "1.0",
      entry: "effect.ts",
      permissions: {
        commands: [
          { id: "cell-click", title: "Click" },
          { id: "cell-hover", title: "Hover" },
        ],
        pointer: { click: "cell-click", hover: "cell-hover" },
      },
    },
    palette: crimson,
  })
  try {
    const results: Array<{ id: string; ok: boolean; message?: string; pointer?: boolean }> = []
    effect.onCommandResult = (result) => results.push(result)
    effect.runPointer("click", { x: 3, y: 4, window: "panel", row: 1, column: 2 }, {
      mode: "normal",
      width: 40,
      height: 12,
    })
    await waitFor(() => results.length > 0)
    expect(results[0]).toEqual({
      id: "cell-click",
      ok: true,
      message: "cell 1:2",
      pointer: true,
    })

    // A pointer command that returns nothing is marked too, so the app can
    // skip its "command ran" notice.
    effect.runPointer("hover", { x: 3, y: 4, row: 0, column: 0 }, {
      mode: "normal",
      width: 40,
      height: 12,
    })
    await waitFor(() => results.length > 1)
    expect(results[1]).toEqual({ id: "cell-hover", ok: true, pointer: true })

    // Rapid repeats (wheel ticks) stay marked as pointer results.
    const state = { mode: "normal", width: 40, height: 12 }
    effect.runPointer("click", { x: 1, y: 2, row: 0, column: 0 }, state)
    effect.runPointer("click", { x: 1, y: 2, row: 0, column: 0 }, state)
    await waitFor(() => results.length > 3)
    expect(results.slice(2)).toEqual([
      { id: "cell-click", ok: true, message: "cell 0:0", pointer: true },
      { id: "cell-click", ok: true, message: "cell 0:0", pointer: true },
    ])
  } finally {
    effect.dispose()
  }
})

test("the worker reports the name assigned in code", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(`export default { id: "sandbox.worker", name: "Code name" }`),
    manifest: manifest(),
    palette: crimson,
  })
  try {
    expect(effect.pluginName).toBe("Code name")
  } finally {
    effect.dispose()
  }
})

test("store writes come back to the host", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(`
      export default {
        id: "sandbox.worker",
        activate(ctx) { ctx.store.set("booted", true) },
        commands: { "save"(ctx) { ctx.store.set("visible", false); return "saved" } },
      }
    `),
    manifest: {
      ...manifest(),
      permissions: { commands: [{ id: "save", title: "Save" }] },
    },
    palette: crimson,
    store: { visible: true },
  })
  try {
    const stores: Array<Record<string, unknown>> = []
    effect.onStoreChange = (data) => stores.push(data)
    effect.command("save", { mode: "normal", width: 40, height: 12 })
    await waitFor(() => stores.length > 0)
    expect(stores[0]).toEqual({ visible: false, booted: true })
  } finally {
    effect.dispose()
  }
})

test("deactivate writes are flushed on dispose", async () => {
  const effect = await SandboxWorkerPlugin.create({
    bundle: await bundle(`
      export default {
        id: "sandbox.worker",
        deactivate(ctx) { ctx.store.set("bye", true) },
      }
    `),
    manifest: manifest(),
    palette: crimson,
  })
  const stores: Array<Record<string, unknown>> = []
  effect.onStoreChange = (data) => stores.push(data)
  effect.dispose()
  await waitFor(() => stores.length > 0)
  expect(stores[0]).toEqual({ bye: true })
})

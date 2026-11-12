import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginManifest, ParticlePermission, ScenePermission } from "../../src/ui/plugins/sandbox/manifest"
import { parseManifest } from "../../src/ui/plugins/sandbox/manifest"
import { bundlePluginEntry } from "../../src/ui/plugins/loader"
import { MAX_BUNDLE_BYTES } from "../../src/ui/plugins/sandbox/limits"
import { SandboxedPlugin } from "../../src/ui/plugins/sandbox/plugin"
import { Sandbox, loadQuickJS } from "../../src/ui/plugins/sandbox/runtime"

const dirs: string[] = []

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

function permissions(overrides: Partial<ParticlePermission> = {}): ParticlePermission {
  return {
    maxParticles: 8,
    layers: ["around"],
    triggers: ["keypress"],
    spawnRate: 0,
    spawnBurst: 2,
    ...overrides,
  }
}

function manifest(id = "sandbox.test", overrides: Partial<ParticlePermission> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id,
    name: "Sandbox test",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: { particles: permissions(overrides) },
  }
}

async function bundle(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lockedin-sandbox-"))
  dirs.push(dir)
  const entry = join(dir, "effect.ts")
  await writeFile(entry, source)
  return bundlePluginEntry(entry)
}

async function boot(source: string, overrides: Partial<ParticlePermission> = {}, id = "sandbox.test") {
  const code = await bundle(source)
  return SandboxedPlugin.create(code, manifest(id, overrides))
}

const BASIC = `
export default {
  id: "sandbox.test",
  maxParticles: 8,
  textLayer: "around",
  spawnRate: 0,
  spawnOn: ["keypress"],
  spawnBurst: 2,
  spawn(ctx, out, index) {
    out.x[index] = ctx.cursor.x
    out.y[index] = ctx.cursor.y
    out.vx[index] = 1
    out.vy[index] = 0
    out.life[index] = 1
    out.maxLife[index] = 1
    out.seed[index] = 0.5
    return true
  },
  step(ctx, out, count) {
    for (let i = 0; i < count; i++) {
      out.x[i] += out.vx[i] * ctx.dt
      out.life[i] -= ctx.dt
    }
  },
  style() { return { glyph: "*", color: "accent", alpha: 0.8 } },
}
`

describe("particle sandbox", () => {
  test("loads, spawns, steps and styles through one boundary", async () => {
    const effect = await boot(BASIC)
    try {
      effect.resize(40, 12)
      effect.setCursor(5, 5)
      effect.event({ kind: "keypress", name: "a" })
      effect.update(1 / 60)
      expect(effect.particleCount).toBe(2)
      const [first] = effect.particles()
      expect(first?.glyph).toBe("*")
      expect(first?.x).toBeGreaterThan(5)
      expect(first?.alpha).toBeCloseTo(0.8)
      expect(first?.color).toBe("accent")
      expect(effect.failed).toBe(false)
    } finally {
      effect.dispose()
    }
  })

  test("the manifest clamps the spawn policy", async () => {
    const effect = await boot(BASIC, { spawnBurst: 1 })
    try {
      effect.resize(40, 12)
      effect.setCursor(5, 5)
      effect.event({ kind: "keypress", name: "a" })
      effect.update(1 / 60)
      expect(effect.particleCount).toBe(1)
    } finally {
      effect.dispose()
    }
  })

  test("an effect cannot use a layer or trigger it was not granted", async () => {
    const effect = await boot(
      BASIC.replace('textLayer: "around"', 'textLayer: "under"').replace('spawnOn: ["keypress"]', 'spawnOn: ["send"]'),
    )
      .then(() => null)
      .catch((error: Error) => error)
    expect(effect).toBeInstanceOf(Error)
    expect(String(effect)).toContain("textLayer")
    expect(String(effect)).toContain("trigger")
  })

  test("a mismatched id is rejected", async () => {
    const error = await boot(BASIC, {}, "sandbox.other")
      .then(() => null)
      .catch((value: Error) => value)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("does not match manifest id")
  })

  test("the host sanitises glyphs, colours and alpha", async () => {
    const effect = await boot(
      BASIC.replace(
        'style() { return { glyph: "*", color: "accent", alpha: 0.8 } },',
        'style() { return { glyph: "\\u0000字", color: "not-a-role", alpha: 9 } },',
      ),
    )
    try {
      effect.resize(40, 12)
      effect.setCursor(5, 5)
      effect.event({ kind: "keypress", name: "a" })
      effect.update(1 / 60)
      const [first] = effect.particles()
      expect(first?.glyph).toBe("·")
      expect(first?.alpha).toBe(1)
      expect(first?.color).toBe("not-a-role")
    } finally {
      effect.dispose()
    }
  })
})

describe("sandbox containment", () => {
  test("no Bun, Node or network globals exist", async () => {
    const module = await loadQuickJS()
    const sandbox = new Sandbox(module)
    try {
      const probe = sandbox.eval(
        `JSON.stringify({
          process: typeof process, Bun: typeof Bun, require: typeof require,
          fetch: typeof fetch, console: typeof console, setTimeout: typeof setTimeout,
          WebAssembly: typeof WebAssembly,
        })`,
        "probe",
      )
      const result = JSON.parse(String(sandbox.context.dump(probe))) as Record<string, string>
      probe.dispose()
      for (const name of ["process", "Bun", "require", "fetch", "console", "setTimeout", "WebAssembly"]) {
        expect(result[name]).toBe("undefined")
      }
    } finally {
      sandbox.dispose()
    }
  })

  test("a load-time infinite loop is interrupted", async () => {
    const code = await bundle(`while (true) {}\nexport default { id: "sandbox.test" }`)
    const started = Date.now()
    const error = await SandboxedPlugin.create(code, manifest(), {
      memoryBytes: 16 * 1024 * 1024,
      stackBytes: 512 * 1024,
      loadTimeoutMs: 80,
      callTimeoutMs: 80,
    })
      .then(() => null)
      .catch((value: Error) => value)
    expect(error).toBeInstanceOf(Error)
    expect(String(error).toLowerCase()).toContain("interrupted")
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("a frame that loops is stopped and the effect is quarantined", async () => {
    const effect = await boot(BASIC.replace('step(ctx, out, count) {', 'step(ctx, out, count) { while (true) {}'))
    try {
      effect.resize(40, 12)
      effect.setCursor(5, 5)
      effect.event({ kind: "keypress", name: "a" })
      const started = Date.now()
      effect.update(1 / 60)
      expect(Date.now() - started).toBeLessThan(1000)
      expect(effect.failed).toBe(true)
      expect(effect.particleCount).toBe(0)
      expect(effect.particles()).toEqual([])
    } finally {
      effect.dispose()
    }
  })

  test("a throwing frame is contained", async () => {
    const effect = await boot(BASIC.replace('step(ctx, out, count) {', 'step(ctx, out, count) { throw new Error("boom")'))
    try {
      effect.resize(40, 12)
      effect.setCursor(5, 5)
      effect.event({ kind: "keypress", name: "a" })
      effect.update(1 / 60)
      expect(effect.failed).toBe(true)
      expect(effect.lastError).toContain("boom")
    } finally {
      effect.dispose()
    }
  })

  test("an out-of-memory allocation is contained and the runtime disposes", async () => {
    const memory = await boot(
      BASIC.replace('step(ctx, out, count) {', 'step(ctx, out, count) { new ArrayBuffer(64 * 1024 * 1024)'),
    )
    try {
      memory.resize(40, 12)
      memory.setCursor(5, 5)
      memory.event({ kind: "keypress", name: "a" })
      memory.update(1 / 60)
      expect(memory.failed).toBe(true)
      expect(String(memory.lastError).toLowerCase()).toContain("out of memory")
    } finally {
      memory.dispose()
    }
  })

  test("an oversized bundle is rejected before evaluation", async () => {
    const error = await SandboxedPlugin.create("x".repeat(MAX_BUNDLE_BYTES + 1), manifest())
      .then(() => null)
      .catch((value: Error) => value)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("limit")
  })
})

const SCENE = `
export default {
  id: "sandbox.scene",
  compose(ctx) {
    return { nodes: [
      { kind: "box", anchor: "top-right", x: 0, y: 0, width: 12, height: 3, title: "mode: " + ctx.state.mode },
      { kind: "text", anchor: "bottom-left", x: 1, y: 0, text: "ready" },
    ] }
  },
}
`

function sceneManifest(scene: Partial<ScenePermission> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: "sandbox.scene",
    name: "Scene test",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {
      scene: {
        anchors: ["top-right", "bottom-left"],
        maxNodes: 8,
        maxText: 64,
        ...scene,
      },
      state: ["mode"],
    },
  }
}

test("a scene-only plugin composes nodes through the sandbox", async () => {
  const effect = await SandboxedPlugin.create(await bundle(SCENE), sceneManifest())
  try {
    expect(effect.hasCompose).toBe(true)
    expect(effect.hasParticles).toBe(false)
    const result = effect.compose({
      state: { mode: "insert", width: 40, height: 12 },
      time: 1,
    }) as { nodes: Array<Record<string, unknown>> }
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0]!.kind).toBe("box")
    expect(result.nodes[0]!.title).toBe("mode: insert")
    expect(result.nodes[1]!.anchor).toBe("bottom-left")
    // A scene-only effect never touches the particle path.
    effect.update(1 / 60)
    expect(effect.particleCount).toBe(0)
  } finally {
    effect.dispose()
  }
})

test("compose without a scene grant is rejected", async () => {
  const error = await SandboxedPlugin.create(await bundle(SCENE), manifest())
    .then(() => null)
    .catch((value: Error) => value)
  expect(error).toBeInstanceOf(Error)
  expect(String(error)).toContain("permissions.scene")
})

test("a throwing compose is contained", async () => {
  const effect = await SandboxedPlugin.create(
    await bundle(SCENE.replace("compose(ctx) {", 'compose(ctx) { throw new Error("scene boom")')),
    sceneManifest(),
  )
  try {
    const result = effect.compose({ state: { mode: "normal", width: 40, height: 12 }, time: 1 })
    expect(result).toEqual({ nodes: [] })
    expect(effect.failed).toBe(true)
    expect(effect.lastError).toContain("scene boom")
  } finally {
    effect.dispose()
  }
})

test("scene manifests are validated", () => {
  const good = parseManifest({
    manifestVersion: 1,
    id: "lab.scene",
    name: "Scene",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: { scene: { anchors: ["top-right"], maxNodes: 4, maxText: 40 } },
  })
  expect(good.ok).toBe(true)
  const badAnchor = parseManifest({
    manifestVersion: 1,
    id: "lab.scene",
    name: "Scene",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: { scene: { anchors: ["middle"], maxNodes: 4, maxText: 40 } },
  })
  expect(badAnchor.ok).toBe(false)
  const noPermission = parseManifest({
    manifestVersion: 1,
    id: "lab.scene",
    name: "Scene",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {},
  })
  expect(noPermission.ok).toBe(false)
})

const COMMANDS = `
let visible = true
export default {
  id: "sandbox.cmd",
  compose() {
    return { nodes: [{ kind: "text", anchor: "top-right", x: 0, y: 0, text: visible ? "on" : "off" }] }
  },
  commands: {
    "status-toggle"() {
      visible = !visible
      return visible ? "card shown" : "card hidden"
    },
  },
}
`

function commandManifest(): PluginManifest {
  return {
    manifestVersion: 1,
    id: "sandbox.cmd",
    name: "Command test",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {
      scene: { anchors: ["top-right"], maxNodes: 4, maxText: 40 },
      commands: [{ id: "status-toggle", title: "Toggle card", keys: "space+s" }],
    },
  }
}

test("a plugin command runs inside the sandbox and changes compose", async () => {
  const effect = await SandboxedPlugin.create(await bundle(COMMANDS), commandManifest())
  try {
    expect(effect.commandIds).toEqual(["status-toggle"])
    const result = effect.runCommand("status-toggle", { state: { width: 40, height: 12 }, time: 1 })
    expect(result).toEqual({ ok: true, message: "card hidden" })
    const scene = effect.compose({ state: { width: 40, height: 12 }, time: 2 }) as {
      nodes: Array<Record<string, string>>
    }
    expect(scene.nodes[0]!.text).toBe("off")
  } finally {
    effect.dispose()
  }
})

test("a command the manifest did not grant is rejected at load", async () => {
  const manifest = commandManifest()
  manifest.permissions.commands = []
  const error = await SandboxedPlugin.create(await bundle(COMMANDS), manifest)
    .then(() => null)
    .catch((value: Error) => value)
  expect(error).toBeInstanceOf(Error)
  expect(String(error)).toContain("status-toggle")
})

test("command grants are validated", () => {
  const base = {
    manifestVersion: 1,
    id: "lab.cmd",
    name: "Cmd",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: { commands: [{ id: "status-toggle", title: "Toggle" }] },
  }
  expect(parseManifest(base).ok).toBe(true)
  expect(
    parseManifest({ ...base, permissions: { commands: [{ id: "status-toggle", title: "Toggle", keys: "space+" }] } }).ok,
  ).toBe(false)
  expect(
    parseManifest({ ...base, permissions: { commands: [{ id: "status-toggle", title: "a" }, { id: "status-toggle", title: "b" }] } }).ok,
  ).toBe(false)
})

test("the effect can set its display name in code", async () => {
  const code = await bundle(`export default { id: "sandbox.scene", name: "Pretty status card", compose() { return { nodes: [] } } }`)
  const effect = await SandboxedPlugin.create(code, sceneManifest())
  try {
    expect(effect.pluginName).toBe("Pretty status card")
  } finally {
    effect.dispose()
  }
  const unnamed = await SandboxedPlugin.create(
    await bundle(`export default { id: "sandbox.scene", compose() { return { nodes: [] } } }`),
    sceneManifest(),
  )
  try {
    expect(unnamed.pluginName).toBeUndefined()
  } finally {
    unnamed.dispose()
  }
})

const PERSIST = `
let visible = true
export default {
  id: "sandbox.scene",
  activate(ctx) {
    const saved = ctx.store.get("visible")
    if (typeof saved === "boolean") visible = saved
    ctx.session.set("started", true)
  },
  commands: {
    "toggle"(ctx) {
      visible = !visible
      ctx.store.set("visible", visible)
      return visible ? "on" : "off"
    },
  },
  deactivate(ctx) {
    ctx.store.set("bye", true)
  },
  compose() {
    return { nodes: [{ kind: "text", anchor: "top-right", x: 0, y: 0, text: visible ? "on" : "off" }] }
  },
}
`

function persistManifest(): PluginManifest {
  const manifest = sceneManifest()
  manifest.permissions.commands = [
    { id: "toggle", title: "Toggle" },
    { id: "bad", title: "Bad" },
  ]
  return manifest
}

test("store survives a reload; session does not", async () => {
  const code = await bundle(PERSIST)
  const first = await SandboxedPlugin.create(code, persistManifest(), undefined, { visible: false })
  try {
    const before = first.compose({ state: { width: 40, height: 12 }, time: 1 }) as {
      nodes: Array<Record<string, string>>
    }
    expect(before.nodes[0]!.text).toBe("off")
    expect(first.runCommand("toggle", { state: { width: 40, height: 12 }, time: 2 })).toEqual({
      ok: true,
      message: "on",
    })
    expect(first.takeStoreChanges()).toEqual({ visible: true })
    expect(first.takeStoreChanges()).toBeNull()
    first.deactivate()
    expect(first.takeStoreChanges()).toEqual({ visible: true, bye: true })
  } finally {
    first.dispose()
  }

  // A new worker starts from the host store; the session API is empty again.
  const second = await SandboxedPlugin.create(code, persistManifest(), undefined, { visible: false })
  try {
    const scene = second.compose({ state: { width: 40, height: 12 }, time: 1 }) as {
      nodes: Array<Record<string, string>>
    }
    expect(scene.nodes[0]!.text).toBe("off")
    const command = second.compose({ state: { width: 40, height: 12 }, time: 2 }) as {
      nodes: Array<Record<string, string>>
    }
    expect(command.nodes[0]!.text).toBe("off")
  } finally {
    second.dispose()
  }
})

test("the store rejects values it cannot persist", async () => {
  const effect = await SandboxedPlugin.create(
    await bundle(`
      export default {
        id: "sandbox.scene",
        commands: { "bad"(ctx) { ctx.store.set("nested", { a: 1 }) } },
      }
    `),
    persistManifest(),
    undefined,
    {},
  )
  try {
    const result = effect.runCommand("bad", { state: { width: 40, height: 12 }, time: 1 })
    expect(result.ok).toBe(false)
    expect(String(result.message)).toContain("string, number, boolean or null")
  } finally {
    effect.dispose()
  }
})

test("the compose frame rate comes from the code and is capped by the manifest", async () => {
  const code = await bundle(`
    export default { id: "sandbox.scene", fps: 120, compose() { return { nodes: [] } } }
  `)
  const manifest = sceneManifest()
  manifest.permissions.scene = { ...manifest.permissions.scene!, fps: 30 }
  const capped = await SandboxedPlugin.create(code, manifest)
  try {
    expect(capped.fps).toBe(30)
  } finally {
    capped.dispose()
  }
  const fallback = await SandboxedPlugin.create(
    await bundle(`export default { id: "sandbox.scene", compose() { return { nodes: [] } } }`),
    sceneManifest(),
  )
  try {
    expect(fallback.fps).toBe(4)
  } finally {
    fallback.dispose()
  }
})

test("the scene fps grant is validated", () => {
  const base = {
    manifestVersion: 1,
    id: "lab.scene",
    name: "Scene",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: { scene: { anchors: ["top-right"], maxNodes: 4, maxText: 40, fps: 30 } },
  }
  expect(parseManifest(base).ok).toBe(true)
  expect(parseManifest({ ...base, permissions: { scene: { ...base.permissions.scene, fps: 0 } } }).ok).toBe(false)
  expect(parseManifest({ ...base, permissions: { scene: { ...base.permissions.scene, fps: 61 } } }).ok).toBe(false)
})

test("a command can copy text only with the clipboard grant", async () => {
  const code = await bundle(`
    export default {
      id: "sandbox.scene",
      commands: {
        "copy-row"() { return { message: "copied row", copy: "alpha · 25:00" } },
      },
    }
  `)
  const manifest = sceneManifest()
  manifest.permissions.commands = [{ id: "copy-row", title: "Copy row" }]

  const refused = await SandboxedPlugin.create(code, manifest)
  try {
    expect(refused.runCommand("copy-row", {})).toEqual({
      ok: false,
      message: "clipboard permission not granted",
    })
  } finally {
    refused.dispose()
  }

  const granted = await SandboxedPlugin.create(code, {
    ...manifest,
    permissions: { ...manifest.permissions, clipboard: true },
  })
  try {
    expect(granted.runCommand("copy-row", {})).toEqual({
      ok: true,
      message: "copied row",
      copy: "alpha · 25:00",
    })
  } finally {
    granted.dispose()
  }
})

test("clipboard payloads are bounded and non-strings are ignored", async () => {
  const huge = await SandboxedPlugin.create(
    await bundle(`
      export default {
        id: "sandbox.scene",
        commands: { "huge"() { return { copy: "x".repeat(9000) } } },
      }
    `),
    {
      ...sceneManifest(),
      permissions: {
        ...sceneManifest().permissions,
        commands: [{ id: "huge", title: "Huge" }],
        clipboard: true,
      },
    },
  )
  try {
    const result = huge.runCommand("huge", {})
    expect(result.ok).toBe(true)
    expect(result.copy).toHaveLength(4096)
  } finally {
    huge.dispose()
  }

  const invalid = await SandboxedPlugin.create(
    await bundle(`
      export default {
        id: "sandbox.scene",
        commands: { "bad"() { return { copy: 42, message: "x".repeat(999) } } },
      }
    `),
    {
      ...sceneManifest(),
      permissions: {
        ...sceneManifest().permissions,
        commands: [{ id: "bad", title: "Bad" }],
        clipboard: true,
      },
    },
  )
  try {
    const result = invalid.runCommand("bad", {})
    expect(result.ok).toBe(true)
    expect(result.copy).toBeUndefined()
    expect(result.message).toHaveLength(300)
  } finally {
    invalid.dispose()
  }
})

test("the clipboard permission must be a boolean", () => {
  const base = {
    manifestVersion: 1,
    id: "lab.scene",
    name: "Scene",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: { scene: { anchors: ["top-right"], maxNodes: 4, maxText: 40 }, clipboard: true },
  }
  expect(parseManifest(base).ok).toBe(true)
  expect(parseManifest({ ...base, permissions: { ...base.permissions, clipboard: "yes" } }).ok).toBe(false)
})

test("pointer permissions must reference granted commands", () => {
  const base = {
    manifestVersion: 1,
    id: "lab.scene",
    name: "Scene",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: {
      scene: { anchors: ["top-right"], maxNodes: 4, maxText: 40 },
      commands: [{ id: "table-click", title: "Click" }],
      pointer: { click: "table-click" },
    },
  }
  expect(parseManifest(base).ok).toBe(true)
  expect(parseManifest({ ...base, permissions: { ...base.permissions, pointer: {} } }).ok).toBe(false)
  expect(
    parseManifest({
      ...base,
      permissions: { ...base.permissions, pointer: { click: "missing" } },
    }).ok,
  ).toBe(false)
  expect(
    parseManifest({
      ...base,
      permissions: { ...base.permissions, pointer: { wheel: "table-click" } },
    }).ok,
  ).toBe(true)
  expect(
    parseManifest({
      ...base,
      permissions: { ...base.permissions, pointer: { wheel: "missing" } },
    }).ok,
  ).toBe(false)
  expect(
    parseManifest({
      ...base,
      permissions: {
        ...base.permissions,
        pointer: { press: "table-click", move: "table-click", release: "table-click" },
      },
    }).ok,
  ).toBe(true)
  expect(
    parseManifest({
      ...base,
      permissions: { ...base.permissions, pointer: { release: "missing" } },
    }).ok,
  ).toBe(false)
  expect(
    parseManifest({
      ...base,
      permissions: { ...base.permissions, pointer: { tap: "table-click" } },
    }).ok,
  ).toBe(false)
})

test("a command can choose its notice level", async () => {
  const effect = await SandboxedPlugin.create(
    await bundle(`
      export default {
        id: "sandbox.scene",
        commands: {
          "warn"() { return { message: "careful", level: "warn" } },
          "bad"() { return { message: "fine", level: "success" } },
        },
      }
    `),
    {
      ...sceneManifest(),
      permissions: {
        ...sceneManifest().permissions,
        commands: [
          { id: "warn", title: "Warn" },
          { id: "bad", title: "Bad level" },
        ],
      },
    },
  )
  try {
    expect(effect.runCommand("warn", {})).toMatchObject({
      ok: true,
      message: "careful",
      level: "warn",
    })
    expect(effect.runCommand("bad", {}).level).toBeUndefined()
  } finally {
    effect.dispose()
  }
})

test("scene grants default to top-left, 24 nodes and 512 characters", () => {
  const manifest = {
    manifestVersion: 1,
    id: "lab.scene",
    name: "Scene",
    version: "1.0.0",
    apiVersion: "1.0",
    entry: "effect.ts",
    permissions: { scene: {} },
  }
  const checked = parseManifest(manifest)
  expect(checked.ok).toBe(true)
  if (!checked.ok) return
  expect(checked.manifest.permissions.scene).toEqual({
    anchors: ["top-left"],
    maxNodes: 24,
    maxText: 512,
  })
})

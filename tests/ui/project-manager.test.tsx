/** Projects use the manager key set: `a` archives, `d` deletes, `x` exports. */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { listZip, readZip } = await import("../../src/services/lockin/zip")
const { projectId } = await import("../../src/services/work/register")

async function withProject() {
  const base = await mkdtemp(join(tmpdir(), "project-manager-"))
  const ws = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!ws.ok) throw new Error("workspace")
  const root = join(base, "atlas")
  await mkdir(root, { recursive: true })
  const ui = await renderApp({
    width: 120,
    height: 36,
    app: () => <App workspace={ws.value} initial={{ pane: "projects" } as never} />,
  })
  await ui.waitFor("LOCKEDIN")
  await ui.waitUntil(() => ui.frame().includes("no projects yet"), { timeoutMs: 5_000 })

  // Name, folder, then the single-agent choice. The new project opens as a
  // buffer, so go back to the manager before acting on its row.
  await ui.press("n")
  await ui.type("atlas")
  await ui.press("return")
  await ui.type(root)
  await ui.press("return")
  await ui.press("return")
  // Registration is asynchronous; wait for the project buffer before opening
  // the command bar, or the late auto-open would replace the Projects pane.
  await ui.waitUntil(() => ui.frame().split("\n")[0]?.includes("atlas") === true, {
    timeoutMs: 5_000,
  })
  await ui.press(":")
  await ui.type("projects")
  await ui.press("return")
  await ui.waitFor("PROJECTS", { maxPasses: 1_000 })
  await ui.waitUntil(() => ui.frame().includes("atlas"), { timeoutMs: 5_000 })
  // The row paints optimistically; the registry write settles behind it.
  const meta = join(ws.value.paths.workProjects, projectId("atlas", []), "meta.json")
  await ui.waitUntil(() => existsSync(meta), { timeoutMs: 5_000 })
  // The project buffer opens only after registration; wait for it before
  // driving project-scoped actions from the manager.
  await ui.waitUntil(() => ui.frame().split("\n")[0]?.includes("atlas") === true, {
    timeoutMs: 5_000,
  })
  return { ui, ws: ws.value, root, meta }
}

/** Mount the same workspace again, the way a restart does. */
async function remount(ws: import("../../src/storage/workspace").Workspace) {
  const ui = await renderApp({
    width: 120,
    height: 36,
    app: () => <App workspace={ws} initial={{ pane: "projects" } as never} />,
  })
  await ui.waitFor("LOCKEDIN")
  return ui
}

describe("creating a project", () => {
  test("a folder the wizard names is created and registered", async () => {
    const base = await mkdtemp(join(tmpdir(), "project-create-"))
    const ws = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
    if (!ws.ok) throw new Error("workspace")
    const root = join(base, "named-by-the-wizard")
    expect(existsSync(root)).toBe(false)

    const ui = await renderApp({
      width: 120,
      height: 36,
      app: () => <App workspace={ws.value} initial={{ pane: "projects" } as never} />,
    })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.waitUntil(() => ui.frame().includes("no projects yet"), { timeoutMs: 5_000 })
      await ui.press("n")
      await ui.type("wizard")
      await ui.press("return")
      await ui.type(root)
      await ui.press("return")
      await ui.press("return")

      const meta = join(ws.value.paths.workProjects, projectId("wizard", []), "meta.json")
      await ui.waitUntil(() => existsSync(meta), { timeoutMs: 5_000 })
      expect(existsSync(root)).toBe(true)
      expect(ui.frame()).toContain("wizard")
    } finally {
      await ui.dispose()
    }
  })

  test("a failed registration closes the optimistic buffer and keeps the manager", async () => {
    const base = await mkdtemp(join(tmpdir(), "project-failure-"))
    const ws = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
    if (!ws.ok) throw new Error("workspace")
    // A file where a parent folder should be makes the leaf impossible to create.
    const blocker = join(base, "blocker")
    await writeFile(blocker, "not a directory\n")

    const ui = await renderApp({
      width: 120,
      height: 36,
      app: () => <App workspace={ws.value} initial={{ pane: "projects" } as never} />,
    })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.waitUntil(() => ui.frame().includes("no projects yet"), { timeoutMs: 5_000 })
      await ui.press("n")
      await ui.type("broken")
      await ui.press("return")
      await ui.type(join(blocker, "child"))
      await ui.press("return")
      await ui.press("return")

      await ui.waitUntil(() => ui.frame().includes("project not saved"))
      await ui.waitUntil(() => ui.frame().includes("PROJECTS"))
      expect(ui.frame()).toContain("no projects yet")
      expect(ui.frame()).not.toContain("broken")
    } finally {
      await ui.dispose()
    }
  })
})

describe("staffing from the Swarms manager", () => {
  test("a swarm created with a project open attaches and persists", async () => {
    const { ui, meta } = await withProject()
    try {
      await ui.press(":")
      await ui.type("swarms")
      await ui.press("return")
      await ui.press("n")
      await ui.type("team")
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Agent in team"), { timeoutMs: 5_000 })
      await ui.press("escape")
      await ui.press("escape")
      await ui.waitUntil(() => ui.frame().includes("AGENTS · atlas"), { timeoutMs: 5_000 })
      const saved = JSON.parse(await readFile(meta, "utf8")) as { mode?: string; swarm_name?: string }
      expect(saved.mode).toBe("swarm")
      expect(saved.swarm_name).toBe("team")
    } finally {
      await ui.dispose()
    }
  })
})

describe("archiving a project", () => {
  test("a twice archives it, and Enter refuses an archived project until restored", async () => {
    const { ui } = await withProject()
    try {
      await ui.press("a")
      const armed = ui.frame()
      expect(armed).toContain("Archive “atlas”?")
      expect(armed).toContain("press a again")
      expect(armed).not.toContain("[archived]")

      await ui.press("a")
      await ui.waitUntil(() => ui.frame().includes("archived project: atlas"), { timeoutMs: 5_000 })
      const archived = ui.frame()
      expect(archived).toContain("[archived]")
      // The manager is still the surface after its buffer closes.
      expect(archived).not.toContain("no projects yet")

      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("this project is archived"), { timeoutMs: 5_000 })

      await ui.press("a")
      expect(ui.frame()).toContain("Restore “atlas”?")
      await ui.press("a")
      await ui.waitUntil(() => ui.frame().includes("restored project: atlas"), { timeoutMs: 5_000 })
      expect(ui.frame()).not.toContain("[archived]")
    } finally {
      await ui.dispose()
    }
  })
})

describe("exporting a project", () => {
  test("x twice writes a metadata zip and leaves the project live", async () => {
    const { ui, ws } = await withProject()
    try {
      await ui.press("x")
      const armed = ui.frame()
      expect(armed).toContain("Export “atlas”?")
      expect(armed).toContain("press x again")

      await ui.press("x")
      await ui.waitUntil(() => ui.frame().includes("exported project: atlas"), { timeoutMs: 5_000 })

      const zip = join(ws.paths.exports, `project-${projectId("atlas", [])}.zip`)
      expect(existsSync(zip)).toBe(true)
      const bytes = new Uint8Array(await readFile(zip))
      expect(listZip(bytes)).toEqual(["README.md", "project.json"])
      const manifest = JSON.parse(new TextDecoder().decode(readZip(bytes)["project.json"]!)) as Record<string, unknown>
      expect(manifest).toMatchObject({
        schema: 1,
        id: projectId("atlas", []),
        name: "atlas",
        mode: "chat",
        archived: false,
      })
      // Export is a copy of the definition: the project row is still here.
      expect(ui.frame()).toContain("atlas")
    } finally {
      await ui.dispose()
    }
  })
})

describe("the registry", () => {
  test("a project survives a restart with the same id and folder", async () => {
    const { ui, ws, root, meta } = await withProject()
    await ui.dispose()

    const again = await remount(ws)
    try {
      await again.waitUntil(() => again.frame().includes("atlas"), { timeoutMs: 5_000 })
      expect(again.frame()).toContain("atlas")
      // The registered root is the resolved path (Windows short paths differ);
      // the chat path is keyed by the stable id, so a restart is the same buffer.
      const saved = JSON.parse(await readFile(meta, "utf8")) as { root: string }
      expect(saved.root).toBe(await realpath(root))
      expect(existsSync(meta)).toBe(true)
    } finally {
      await again.dispose()
    }
  })

  test("the archive flag is stored, not just painted", async () => {
    const { ui, ws, meta } = await withProject()
    await ui.press("a")
    await ui.press("a")
    await ui.waitUntil(() => ui.frame().includes("archived project: atlas"), { timeoutMs: 5_000 })
    await ui.waitUntil(
      async () => {
        const raw = JSON.parse(await readFile(meta, "utf8")) as { archived?: boolean }
        return raw.archived === true
      },
      { timeoutMs: 5_000 },
    )
    await ui.dispose()

    const again = await remount(ws)
    try {
      await again.waitUntil(() => again.frame().includes("atlas"), { timeoutMs: 5_000 })
      expect(again.frame()).toContain("[archived]")
    } finally {
      await again.dispose()
    }
  })
})

describe("deleting a project", () => {
  test("a twice deletes it and leaves the Projects manager open and empty", async () => {
    const { ui } = await withProject()
    try {
      await ui.press("d")
      expect(ui.frame()).toContain("Delete “atlas”?")
      expect(ui.frame()).toContain("press d again")

      await ui.press("d")
      await ui.waitUntil(() => ui.frame().includes("deleted project: atlas"), { timeoutMs: 5_000 })
      const frame = ui.frame()
      expect(frame).toContain("no projects yet")
      // Acting from the manager does not dump you into the chat.
      expect(frame).not.toContain("what do you want to learn today")
    } finally {
      await ui.dispose()
    }
  })

  test("Esc disarms a pending delete", async () => {
    const { ui } = await withProject()
    try {
      await ui.press("d")
      expect(ui.frame()).toContain("press d again")
      await ui.press("escape")
      await ui.idle(5)
      expect(ui.frame()).toContain("atlas")
      // A fresh `d` arms again rather than deleting.
      await ui.press("d")
      expect(ui.frame()).toContain("press d again")
    } finally {
      await ui.dispose()
    }
  })
})

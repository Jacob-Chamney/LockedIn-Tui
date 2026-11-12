/** The file finder: home-scoped search, preview and folder marking. */
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "source-finder-ui-"))
  const made = await createWorkspace(join(base, "ws"))
  if (!made.ok) throw new Error("workspace")
  const home = join(base, "home")
  await mkdir(join(home, "Documents"), { recursive: true })
  await writeFile(join(home, "Documents", "notes.md"), "# Home notes\n\nFind me from home.\n")
  await writeFile(join(made.value.paths.input, "input.md"), "# Input\n\nINPUT PREVIEW LINE\n")
  return { base, workspace: made.value, home }
}

async function openFinder(workspace: Awaited<ReturnType<typeof fixture>>["workspace"], home: string) {
  const ui = await renderApp({
    width: 120,
    height: 36,
    app: () => (
      <App
        workspace={workspace}
        sourceHome={home}
        initial={{ pane: "manager" } as never}
        loadSessions={async () => [] as never}
      />
    ),
  })
  await ui.waitFor("LOCK-IN SESSIONS")
  await ui.press("n")
  await ui.type("Physics")
  await ui.press("return")
  await ui.waitUntil(() => ui.frame().includes("ADD SOURCES"))
  return ui
}

describe("file finder", () => {
  test("previews the highlighted file", async () => {
    const { workspace, home } = await fixture()
    const ui = await openFinder(workspace, home)
    try {
      await ui.waitUntil(() => ui.frame().includes("INPUT PREVIEW LINE"))
      expect(ui.frame()).toContain("PREVIEW")
    } finally {
      await ui.dispose()
    }
  }, 30_000)

  test("search defaults to home and Enter chooses a result", async () => {
    const { workspace, home } = await fixture()
    const ui = await openFinder(workspace, home)
    try {
      await ui.press("/")
      for (const char of "notes") await ui.press(char)
      const homeFile = join("Documents", "notes.md")
      await ui.waitUntil(() => ui.frame().includes(homeFile))
      expect(ui.frame()).toContain("scope: ~")
      // Ctrl+F narrows the same query to the current folder, then home again.
      await ui.press("f", { ctrl: true })
      await ui.waitUntil(() => ui.frame().includes("scope: folder"))
      await ui.waitUntil(() => !ui.frame().includes(homeFile))
      await ui.press("f", { ctrl: true })
      await ui.waitUntil(() => ui.frame().includes(homeFile))
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("1 of 25 sources selected"))
      expect(ui.frame()).toContain("notes.md")

      // The selection pane can remove the chosen result again.
      await ui.press("tab")
      await ui.press("d")
      await ui.waitUntil(() => ui.frame().includes("0 of 25 sources selected"))
    } finally {
      await ui.dispose()
    }
  }, 30_000)

  test("A marks the folder under the cursor", async () => {
    const { workspace, home } = await fixture()
    await mkdir(join(workspace.paths.input, "bundle"), { recursive: true })
    await writeFile(join(workspace.paths.input, "bundle", "a.md"), "a\n")
    await writeFile(join(workspace.paths.input, "bundle", "b.md"), "b\n")
    const ui = await openFinder(workspace, home)
    try {
      await ui.waitUntil(() => ui.frame().includes("bundle"))
      await ui.press("A")
      await ui.waitUntil(() => ui.frame().includes("2 of 25 sources selected"))
      await ui.press("r")
      await ui.waitUntil(() => ui.frame().includes("REVIEW · 2 sources"))
      expect(ui.frame()).toContain("a.md")
      expect(ui.frame()).toContain("b.md")
    } finally {
      await ui.dispose()
    }
  }, 30_000)
})

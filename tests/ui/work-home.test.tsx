/** A project opens on chat, not an intermediate project-home panel. */
import { expect, test } from "bun:test"
import { mkdtemp, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { register } = await import("../../src/services/work/register")

test("opening a project lands on its chat, with no project-home panel", async () => {
  const base = await mkdtemp(join(tmpdir(), "work-home-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const root = join(base, "atlas")
  await mkdir(root, { recursive: true })
  const registered = await register({ workspace: made.value, root, name: "Atlas" })
  if (!registered.ok) throw new Error(registered.error.message)

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={made.value} initial={{ pane: "projects" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Atlas"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().split("\n")[0]?.includes("Atlas › Chat") === true)

    const frame = ui.frame()
    // The old home blocks are gone; the chat surface is what opened.
    expect(frame).not.toContain("agents · 0")
    expect(frame).not.toContain("not a repository")
    expect(frame).not.toContain("choose a default agent")
    expect(frame).toContain("Ask anything")
  } finally {
    await ui.dispose()
  }
}, 30_000)

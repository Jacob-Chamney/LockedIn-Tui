/** A session with no chat opens on chat, not on the old session-home panel. */
import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createLockInSession } = await import("../../src/services/lockin/create")

async function sessionWithSource(name = "Physics") {
  const base = await mkdtemp(join(tmpdir(), "session-chat-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const inputs = join(base, "input")
  await mkdir(inputs, { recursive: true })
  const source = join(inputs, "notes.md")
  await writeFile(source, "# Notes\n\nStack frames.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name,
    prompt: "Study the problem set.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  return { base, workspace: made.value, created: created.value }
}

test("a fresh session opens on chat, not the session home", async () => {
  const { workspace } = await sessionWithSource()
  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={workspace} sourceHome={workspace.paths.input} initial={{ pane: "manager" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("what do you want to learn today?"))

    const frame = ui.frame()
    expect(frame).toContain("LEARN › Physics › Chat")
    expect(frame).not.toContain("created 2026")
    expect(frame).not.toContain("sources · 1")
    expect(frame).toContain("Ask anything")
    // Session buffers split chat with the steps reader, like skill sessions.
    expect(frame).toContain("STEPS · assignment-steps.md")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test(":add-sources opens the picker for the open session", async () => {
  const { workspace } = await sessionWithSource()
  await writeFile(join(workspace.paths.input, "extra.md"), "# Extra\n")
  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={workspace} sourceHome={workspace.paths.input} initial={{ pane: "manager" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("what do you want to learn today?"))

    await ui.press(":")
    for (const char of "add-sources") await ui.press(char)
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("ADD SOURCES"))
    await ui.press("space")
    await ui.press("r")
    await ui.waitUntil(() => ui.frame().includes("REVIEW"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("added 1 source"))
    expect(ui.frame()).toContain("added 1 source")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("a plain s reopens the source picker, and / focuses its input", async () => {
  const { workspace } = await sessionWithSource()
  const aaa = join(workspace.paths.input, "aaa")
  await mkdir(aaa, { recursive: true })

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={workspace} sourceHome={workspace.paths.input} initial={{ pane: "manager" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("what do you want to learn today?"))

    // A plain `s` opens the picker; the chat remains behind it.
    await ui.press("s")
    await ui.waitUntil(() => ui.frame().includes("ADD SOURCES"))
    expect(ui.frame()).toContain("Path or filter — press / to type")

    // Enter goes into a folder; Backspace returns to its parent.
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes(aaa))
    await ui.press("backspace")
    await ui.waitUntil(() => !ui.frame().includes(aaa))

    // Backspace keeps climbing past the workspace: browsing is not confined
    // to the project folder.
    await ui.press("backspace")
    await ui.waitUntil(() => !ui.frame().includes(workspace.paths.input))
    await ui.press("backspace")
    await ui.waitUntil(() => !ui.frame().includes(workspace.paths.root))

    // Inside the window `/` takes the path input; `s` is just typed text.
    await ui.press("/")
    await ui.waitUntil(() => ui.frame().includes("Enter apply"))
    await ui.press("s")
    expect(ui.frame()).toContain("> s")
  } finally {
    await ui.dispose()
  }
}, 30_000)

/** Session settings: instructions preview, edit and atomic save. */
import { expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildPdf } from "../unit/helpers/ooxml"
const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createLockInSession } = await import("../../src/services/lockin/create")

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "session-settings-ui-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const source = join(base, "notes.md")
  await writeFile(source, "# Notes\n\nRegisters hold working state.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name: "Physics",
    prompt: "Study the problem set.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  return { base, workspace: made.value, folder: created.value.folder }
}

async function openSession() {
  const fixture = await setup()
  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={fixture.workspace} initial={{ pane: "manager" } as never} />,
  })
  await ui.waitUntil(() => ui.frame().includes("Physics"))
  await ui.press("return")
  await ui.waitUntil(() => ui.frame().includes("STEPS"))
  return { ui, ...fixture }
}

test("the active session exposes Session settings and edits prompt.md", async () => {
  const { ui, folder } = await openSession()
  try {
    await ui.press(":")
    await ui.type("session-settings")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("SESSION SETTINGS"))
    await ui.waitUntil(() => ui.frame().includes("Study the problem set."))
    expect(ui.frame()).toContain("ASSIGNMENT INSTRUCTIONS")

    await ui.press("e")
    await ui.waitUntil(() => ui.frame().includes("EDIT INSTRUCTIONS"))
    await ui.type(" Updated")
    await ui.press("s", { ctrl: true })
    await ui.waitUntil(() => ui.frame().includes("instructions saved"))
    await ui.waitUntil(async () => (await readFile(join(folder, "prompt.md"), "utf8")).includes("Updated"), {
      timeoutMs: 5_000,
    })
    const text = await readFile(join(folder, "prompt.md"), "utf8")
    expect(text).toContain("Study the problem set.")
    expect(text).toContain("Updated")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("Esc with unsaved edits requires a second Esc", async () => {
  const { ui } = await openSession()
  try {
    await ui.press(":")
    await ui.type("session-settings")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("SESSION SETTINGS"))
    // Wait for the loader, not only the frame: `e` is disabled until data arrives.
    await ui.waitUntil(() => ui.frame().includes("Study the problem set."))
    await ui.press("e")
    await ui.waitUntil(() => ui.frame().includes("EDIT INSTRUCTIONS"))
    await ui.type(" changed")
    await ui.press("escape")
    expect(ui.frame()).toContain("press Esc again")
    await ui.press("escape")
    await ui.waitUntil(() => ui.frame().includes("SESSION SETTINGS"))
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("f loads a PDF as the assignment instructions through the picker", async () => {
  const pdftotext = Bun.which("pdftotext", { PATH: process.env.PATH ?? "" })
  if (!pdftotext) return
  const fixture = await setup()
  await writeFile(
    join(fixture.workspace.paths.input, "ComplexNumbers.pdf"),
    buildPdf({ text: ["COMPLEX NUMBERS HOMEWORK", "SUBTRACTION", "MULTIPLICATION"] }),
  )
  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={fixture.workspace} initial={{ pane: "manager" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("STEPS"))
    await ui.press(":")
    await ui.type("session-settings")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("SESSION SETTINGS"))
    await ui.press("f")
    await ui.waitUntil(() => ui.frame().includes("INSTRUCTIONS FILE"))
    await ui.press("space")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("SUBTRACTION"), { timeoutMs: 5_000 })
    const text = await readFile(join(fixture.folder, "prompt.md"), "utf8")
    expect(text).toContain("SUBTRACTION")
    expect(text).toContain("MULTIPLICATION")
    expect(ui.frame()).toContain("ComplexNumbers.pdf")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("Session settings is refused from Chill instead of opening an error pane", async () => {
  const ui = await renderApp({
    width: 120,
    height: 32,
    app: () => <App />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("CHILL"))
    await ui.press(":")
    await ui.type("session-settings")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("open a lock-in session"))
    expect(ui.frame()).not.toContain("SESSION SETTINGS")
  } finally {
    await ui.dispose()
  }
}, 30_000)

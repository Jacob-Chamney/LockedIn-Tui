/** Creating a lock-in session follows the picker: name, sources, review. */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { mkdtemp, readFile, readdir, writeFile } = await import("node:fs/promises")
const { tmpdir } = await import("node:os")
const { join } = await import("node:path")
const { buildPdf } = await import("../unit/helpers/ooxml")

async function workspaceWithSource() {
  const base = await mkdtemp(join(tmpdir(), "lockin-create-ui-"))
  const made = await createWorkspace(join(base, "ws"))
  if (!made.ok) throw new Error("workspace")
  await writeFile(join(made.value.paths.input, "notes.md"), "# Notes\n\nStack frames.\n")
  return made.value
}

describe("creating a lock-in session", () => {
  test("n names it, the picker marks a source, review creates it", async () => {
    const workspace = await workspaceWithSource()
    const ui = await renderApp({
      width: 120,
      height: 34,
      app: () => (
        <App
          workspace={workspace}
          initial={{ pane: "manager" } as never}
          loadSessions={async () => [] as never}
          createLockIn={async () => ({ ok: true, session: { id: "physics", name: "Physics" } })}
        />
      ),
    })
    try {
      await ui.waitFor("LOCK-IN SESSIONS")
      await ui.press("n")
      expect(ui.frame()).toContain("New lock-in session")
      await ui.type("Physics")
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("notes.md"))
      expect(ui.frame()).toContain("SOURCES")
      await ui.press("space")
      await ui.press("r")
      await ui.waitUntil(() => ui.frame().includes("REVIEW"))
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Assignment instructions"))
      // The default choice is "Write instructions".
      await ui.press("return")
      await ui.waitUntil(() => ui.frame().includes("Goal or assignment"))
      await ui.type("Study stack frames")
      await ui.press("return")
      // The new session opens as its own buffer and the manager knows the row.
      await ui.waitUntil(() => ui.frame().split("\n")[0]!.includes("Physics"))
      expect(ui.frame()).toContain("Ask anything")

      // Opening the Explorer names the session buffer under LEARN.
      await ui.press("space")
      await ui.press("e")
      await ui.waitUntil(() => ui.frame().includes("LOCK-IN · Physics"))
      expect(ui.frame()).toContain("▌ Chat")
    } finally {
      await ui.dispose()
    }
  })
})

test("creating a session generates its steps", async () => {
  const workspace = await workspaceWithSource()
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        workspace={workspace}
        initial={{ pane: "manager" } as never}
        loadSessions={async () => [] as never}
        generate={async () =>
          JSON.stringify({
            phases: [
              { phase: "Understand", items: ["Read the notes", "Trace a stack frame"] },
              { phase: "Apply", items: ["Solve one exercise", "Explain the result"] },
            ],
          })
        }
      />
    ),
  })
  try {
    await ui.waitFor("LOCK-IN SESSIONS")
    await ui.press("n")
    await ui.type("Physics")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("notes.md"))
    await ui.press("space")
    await ui.press("r")
    await ui.waitUntil(() => ui.frame().includes("REVIEW"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Assignment instructions"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Goal or assignment"))
    await ui.type("Study stack frames")
    await ui.press("return")

    await ui.waitUntil(() => ui.frame().includes("Trace a stack frame"))
    const [session] = await readdir(workspace.paths.schoolSessions)
    if (session === undefined) throw new Error("session folder")
    const steps = await readFile(join(workspace.paths.schoolSessions, session, "assignment-steps.md"), "utf8")
    expect(steps).toContain("- [ ] Read the notes")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("the source window closes before a slow session creation begins", async () => {
  const workspace = await workspaceWithSource()
  let release!: (value: { ok: true; session: { id: string; name: string } }) => void
  const pending = new Promise<{ ok: true; session: { id: string; name: string } }>((resolve) => {
    release = resolve
  })
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        workspace={workspace}
        initial={{ pane: "manager" } as never}
        loadSessions={async () => [] as never}
        createLockIn={() => pending}
      />
    ),
  })
  try {
    await ui.waitFor("LOCK-IN SESSIONS")
    await ui.press("n")
    await ui.type("Physics")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("notes.md"))
    await ui.press("space")
    await ui.press("r")
    await ui.waitUntil(() => ui.frame().includes("REVIEW"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Assignment instructions"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Goal or assignment"))
    await ui.type("Study stack frames")
    await ui.press("return")

    // Creation is still pending, but the picker must not linger over the chat.
    await ui.waitUntil(() => !ui.frame().includes("ADD SOURCES"))
    expect(ui.frame()).toContain("Ask anything")

    release({ ok: true, session: { id: "physics", name: "Physics" } })
    await ui.waitUntil(() => ui.frame().split("\n")[0]!.includes("Physics"))
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("a failed creation restores the picker with its marks", async () => {
  const workspace = await workspaceWithSource()
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        workspace={workspace}
        initial={{ pane: "manager" } as never}
        loadSessions={async () => [] as never}
        createLockIn={async () => ({ ok: false, message: "copy failed" })}
      />
    ),
  })
  try {
    await ui.waitFor("LOCK-IN SESSIONS")
    await ui.press("n")
    await ui.type("Physics")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("notes.md"))
    await ui.press("space")
    await ui.press("r")
    await ui.waitUntil(() => ui.frame().includes("REVIEW"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Assignment instructions"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Goal or assignment"))
    await ui.type("Study stack frames")
    await ui.press("return")

    await ui.waitUntil(() => ui.frame().includes("ADD SOURCES"))
    expect(ui.frame()).toContain("SOURCES · 1")
    expect(ui.frame()).toContain("copy failed")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("choosing a file for instructions browses like sources and passes it to create", async () => {
  const base = await mkdtemp(join(tmpdir(), "lockin-create-file-ui-"))
  const made = await createWorkspace(join(base, "ws"))
  if (!made.ok) throw new Error("workspace")
  await writeFile(join(made.value.paths.input, "notes.md"), "# Notes\n\nStack frames.\n")
  await writeFile(
    join(made.value.paths.input, "ComplexNumbers.pdf"),
    buildPdf({ text: ["COMPLEX NUMBERS HOMEWORK", "SUBTRACTION"] }),
  )

  const requests: Array<{ name?: string; prompt?: string; files?: string[]; instructionsFile?: string }> = []
  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "manager" } as never}
        loadSessions={async () => [] as never}
        createLockIn={async (request) => {
          requests.push(request as never)
          return { ok: true, session: { id: "physics", name: "Physics" } }
        }}
      />
    ),
  })
  try {
    await ui.waitFor("LOCK-IN SESSIONS")
    await ui.press("n")
    await ui.type("Physics")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("notes.md"))
    // Entries sort by name: ComplexNumbers.pdf is first, notes.md second.
    await ui.press("j")
    await ui.press("space")
    await ui.press("r")
    await ui.waitUntil(() => ui.frame().includes("REVIEW"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Assignment instructions"))
    await ui.press("j")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("INSTRUCTIONS FILE"))
    await ui.press("space")
    await ui.press("return")
    await ui.waitUntil(() => requests.length === 1)
    expect(requests[0]!.files?.[0]).toEndWith("notes.md")
    expect(requests[0]!.instructionsFile).toEndWith("ComplexNumbers.pdf")
    expect(requests[0]!.prompt).toBe("")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("Esc from the instructions picker returns to the source review", async () => {
  const base = await mkdtemp(join(tmpdir(), "lockin-create-file-esc-"))
  const made = await createWorkspace(join(base, "ws"))
  if (!made.ok) throw new Error("workspace")
  await writeFile(join(made.value.paths.input, "notes.md"), "# Notes\n\nStack frames.\n")
  await writeFile(join(made.value.paths.input, "assignment.pdf"), buildPdf({ text: ["Assignment"] }))

  const ui = await renderApp({
    width: 120,
    height: 34,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "manager" } as never}
        loadSessions={async () => [] as never}
        createLockIn={async () => ({ ok: true, session: { id: "physics", name: "Physics" } })}
      />
    ),
  })
  try {
    await ui.waitFor("LOCK-IN SESSIONS")
    await ui.press("n")
    await ui.type("Physics")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("notes.md"))
    await ui.press("j")
    await ui.press("space")
    await ui.press("r")
    await ui.waitUntil(() => ui.frame().includes("REVIEW"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Assignment instructions"))
    await ui.press("j")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("INSTRUCTIONS FILE"))
    await ui.press("escape")
    await ui.waitUntil(() => ui.frame().includes("REVIEW"))
    expect(ui.frame()).toContain("ADD SOURCES")
    expect(ui.frame()).not.toContain("INSTRUCTIONS FILE")
  } finally {
    await ui.dispose()
  }
}, 30_000)

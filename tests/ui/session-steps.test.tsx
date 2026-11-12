/** A lock-in session's steps open in the reader and toggle the Markdown file. */
import { expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createLockInSession } = await import("../../src/services/lockin/create")
const { createChatController } = await import("../../src/app/chat-controller")
const { writeSteps } = await import("../../src/services/lockin/steps")

const budget = {
  key: () => "test",
  isOverridden: () => false,
  overrideOnce: () => {},
  check: () => ({ block: null, state: { spent: 0, limit: 0, period: "day" } as never }),
}

const STEPS = [
  "# Assignment steps",
  "",
  "> 0 of 3 steps done",
  "",
  "## Understand",
  "",
  "- [ ] Read section 4.2",
  "- [ ] Derive the energy balance",
  "",
  "## Solve",
  "",
  "- [ ] Set up the equations",
  "",
].join("\n")

test("space r opens the steps, x toggles only that checkbox and the progress line", async () => {
  const base = await mkdtemp(join(tmpdir(), "session-steps-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name: "Physics",
    prompt: "Study the problem set.",
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  await writeSteps(created.value.folder, STEPS)

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "manager" } as never}
        createChat={(history) =>
          createChatController({
            service: {
              active: () => [],
              cancel: () => {},
              // eslint-disable-next-line require-yield
              async *send() {
                return
              },
            },
            budget,
            history,
            scope: "school",
            config: () => ({ model: null, maxToolCalls: 8, maxTokens: 16000, chillHistoryLimit: 20 }),
          })
        }
      />
    ),
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    // The session opens split with its steps reader already visible.
    await ui.waitUntil(() => ui.frame().includes("STEPS · assignment-steps.md"))
    // The "opened session" toast sits over the reader's top-right corner, so
    // the progress line is partly covered; the rows and the file are not.
    expect(ui.frame()).toContain("0 of 3")
    expect(ui.frame()).toContain("☐  Read section 4.2")

    await ui.press("x")
    await ui.waitUntil(() => ui.frame().includes("✓  Read section 4.2"))
    expect(ui.frame()).toContain("✓  Read section 4.2")

    const onDisk = await readFile(join(created.value.folder, "assignment-steps.md"), "utf8")
    expect(onDisk).toContain("- [x] Read section 4.2")
    expect(onDisk).toContain("- [ ] Derive the energy balance")
    expect(onDisk).toContain("> 1 of 3 steps done")

    // `i` shows the original assignment prompt in the reader.
    await ui.press("i")
    await ui.waitUntil(() => ui.frame().includes("Assignment instructions"))
    expect(ui.frame()).toContain("Study the")
    await ui.press("i")
    await ui.waitUntil(() => ui.frame().includes("STEPS · assignment-steps.md"))

    // `a` copies the highlighted step into the chat composer and focuses it.
    await ui.press("a")
    await ui.waitUntil(() => ui.frame().includes("[Asking]"))
    expect(ui.frame()).toContain("Read section 4.2")
    expect(ui.frame()).toContain("INSERT")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("a long step stays readable in the split reader at 100x24", async () => {
  const base = await mkdtemp(join(tmpdir(), "session-steps-long-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name: "Physics",
    prompt: "Study the problem set.",
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  const long = [
    "# Assignment steps",
    "",
    "> 0 of 2 steps done",
    "",
    "## Understand",
    "",
    "- [ ] This is a deliberately long assignment step that must wrap inside the split reader instead of running off the right edge",
    "- [ ] A second step keeps the footer and the selected row visible",
    "",
  ].join("\n")
  await writeSteps(created.value.folder, long)

  const ui = await renderApp({
    width: 100,
    height: 24,
    app: () => <App workspace={made.value} initial={{ pane: "manager" } as never} />,
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("STEPS · assignment-steps.md"))
    const frame = ui.frame()
    expect(frame).toContain("deliberately long assignment")
    expect(frame).toContain("right")
    expect(frame).toContain("edge")
    expect(frame).toContain("x toggle")
    for (const line of ui.lines()) expect(line.length).toBe(100)
  } finally {
    await ui.dispose()
  }
}, 30_000)

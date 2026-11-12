/** `:review` lists the real queue and opens the item's context. */
import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createLockInSession } = await import("../../src/services/lockin/create")
const { writeSteps } = await import("../../src/services/lockin/steps")

const STEPS = [
  "# Assignment steps",
  "",
  "> 0 of 2 steps done",
  "",
  "- [x] Read section 4.2",
  "- [ ] Derive the energy balance",
  "",
].join("\n")

test("the queue lists an unchecked step and Enter opens its session", async () => {
  const base = await mkdtemp(join(tmpdir(), "review-ui-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name: "Physics",
    prompt: "Study.",
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  await writeSteps(created.value.folder, STEPS)

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => <App workspace={made.value} />,
  })
  try {
    await ui.waitFor("LOCKEDIN")
    await ui.press(":")
    for (const char of "review") await ui.press(char)
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Derive the energy balance"))

    const frame = ui.frame()
    expect(frame).toContain("REVIEW QUEUE")
    expect(frame).toContain("Physics")

    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("LEARN"))
    expect(ui.frame().split("\n")[0]).toContain("Physics")
  } finally {
    await ui.dispose()
  }
}, 30_000)

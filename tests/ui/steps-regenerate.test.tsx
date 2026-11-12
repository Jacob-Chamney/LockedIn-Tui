/** R regenerates steps from the session sources and keeps checked text. */
import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { createLockInSession } = await import("../../src/services/lockin/create")
const { writeSteps } = await import("../../src/services/lockin/steps")

const STEPS = [
  "# Assignment steps",
  "",
  "> 1 of 2 steps done",
  "",
  "## Understand",
  "",
  "- [x] Read section 4.2",
  "- [ ] Derive the energy balance",
  "",
].join("\n")

test("R twice regenerates and keeps a checked step", async () => {
  const base = await mkdtemp(join(tmpdir(), "steps-regen-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const source = join(base, "notes.md")
  await writeFile(source, "# Notes\n\nRegisters hold working state.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name: "Physics",
    prompt: "Study.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)
  await writeSteps(created.value.folder, STEPS)

  const prompts: string[] = []
  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "manager" } as never}
        generate={async (prompt) => {
          prompts.push(prompt)
          return JSON.stringify({
            phases: [
              { phase: "Understand", items: ["Read section 4.2", "Trace a register", "New deep step"] },
              { phase: "Apply", items: ["Solve one exercise"] },
            ],
          })
        }}
      />
    ),
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    // A session opens split: chat on the left and its steps on the right.
    await ui.waitUntil(() => ui.frame().includes("STEPS · assignment-steps.md"))
    await ui.waitUntil(() => ui.frame().includes("Read section 4.2"))
    await ui.press("r", { shift: true })
    await ui.waitUntil(() => ui.frame().includes("Press R again"))
    await ui.press("r", { shift: true })
    await ui.waitUntil(() => ui.frame().includes("New deep step"))

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("Registers hold working state")
    const onDisk = await readFile(join(created.value.folder, "assignment-steps.md"), "utf8")
    expect(onDisk).toContain("- [x] Read section 4.2")
    expect(onDisk).toContain("- [ ] New deep step")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("a session with no steps builds them when it opens", async () => {
  const base = await mkdtemp(join(tmpdir(), "steps-missing-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const source = join(base, "notes.md")
  await writeFile(source, "# Notes\n\nRegisters hold working state.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name: "Physics",
    prompt: "Study.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)

  const prompts: string[] = []
  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "manager" } as never}
        generate={async (prompt) => {
          prompts.push(prompt)
          return JSON.stringify({
            phases: [
              { phase: "Understand", items: ["Read section 4.2", "Trace a register"] },
              { phase: "Apply", items: ["Solve one exercise", "Explain the result"] },
            ],
          })
        }}
      />
    ),
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("Trace a register"))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("Registers hold working state")
    const onDisk = await readFile(join(created.value.folder, "assignment-steps.md"), "utf8")
    expect(onDisk).toContain("- [ ] Read section 4.2")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test("an overloaded provider shows one actionable line", async () => {
  const base = await mkdtemp(join(tmpdir(), "steps-rate-limit-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const source = join(base, "notes.md")
  await writeFile(source, "# Notes\n\nRegisters hold working state.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name: "Physics",
    prompt: "Study.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "manager" } as never}
        generate={async () => {
          throw new Error("generation failed: The provider is overloaded upstream.")
        }}
      />
    ),
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("overloaded upstream"))
    const frame = ui.frame()
    expect(frame).toContain("press R")
    expect(frame).toContain("generation model in Settings")
    expect(frame).not.toContain("generation failed")
    expect(frame).not.toContain("rate limiting")
  } finally {
    await ui.dispose()
  }
}, 30_000)

test(":regenerate-steps in chat rebuilds without sending a model message", async () => {
  const base = await mkdtemp(join(tmpdir(), "steps-command-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const source = join(base, "notes.md")
  await writeFile(source, "# Notes\n\nRegisters hold working state.\n")
  const created = await createLockInSession({
    workspace: made.value,
    created: "2026-11-01T14:30:00Z",
    name: "Physics",
    prompt: "Study.",
    files: [source],
    steps: false,
  })
  if (!created.ok) throw new Error(created.error.message)

  const prompts: string[] = []
  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "manager" } as never}
        generate={async (prompt) => {
          prompts.push(prompt)
          return JSON.stringify({
            phases: [
              { phase: "Understand", items: ["Open notes.md and list the registers", "Trace a register"] },
              { phase: "Apply", items: ["Solve one exercise", "Explain the result"] },
            ],
          })
        }}
      />
    ),
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("Physics"))
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("STEPS"))
    // Close the split reader, focus the composer, then run the local command.
    await ui.press("escape")
    await ui.press("i")
    await ui.type(":regenerate-steps")
    await ui.press("return")
    await ui.waitUntil(async () => {
      try {
        return (await readFile(join(created.value.folder, "assignment-steps.md"), "utf8")).includes(
          "Trace a register",
        )
      } catch {
        return false
      }
    })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain("Registers hold working state")
    const onDisk = await readFile(join(created.value.folder, "assignment-steps.md"), "utf8")
    expect(onDisk).toContain("- [ ] Trace a register")
    expect(ui.frame()).not.toContain(":regenerate-steps")
  } finally {
    await ui.dispose()
  }
}, 30_000)

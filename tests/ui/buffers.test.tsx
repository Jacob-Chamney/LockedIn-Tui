/**
 * Buffers, the way an editor treats windows.
 *
 * The Chill chat is the home buffer; opening a project (or one of its agents)
 * pushes another. `:q` closes the one you are in, `:qo` closes the others,
 * `:qa` closes them all, `:bn`/`:bp` step, `:ls` lists, and ␣ 0 or Esc
 * close the current buffer.
 */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
type ShellApi = import("../../src/app/App").ShellApi
const commands = await import("../../src/ui/shell/commands")
const { createDefaultActions } = await import("../../src/ui/keymap/defaults")
const { KeymapRegistry } = await import("../../src/ui/keymap/registry")

const registry = new KeymapRegistry(createDefaultActions(() => {}))

async function open() {
  let api!: ShellApi
  const ui = await renderApp({
    width: 140,
    height: 30,
    app: () => <App initial={{ pane: "projects" } as never} api={(value) => (api = value)} />,
  })
  await ui.waitFor("LOCKEDIN")
  const run = async (command: string) => {
    await ui.press(":")
    for (const char of command) await ui.press(char)
    await ui.press("return")
  }
  const project = async (name: string) => {
    await run("projects")
    await ui.press("n")
    await ui.type(name)
    await ui.press("return")
    await ui.press("return")
    await ui.press("return")
  }
  return { ui, api: () => api, run, project }
}

const top = (ui: { frame: () => string }) => ui.frame().split("\n")[0] ?? ""

describe("the verbs", () => {
  test("all of them resolve to shell actions, not unknown commands", () => {
    for (const name of ["q", "qo", "qa", "bn", "bp", "ls"]) {
      expect(commands.resolveCommand(registry, name).kind).toBe("action")
    }
    // Quitting the app is still its own verb.
    expect(commands.resolveCommand(registry, "quit")).toEqual({ kind: "action", id: "quit" })
  })
})

describe("buffer lifecycle", () => {
  test("opening a project pushes a buffer and :ls lists it", async () => {
    const { ui, api, project, run } = await open()
    try {
      await project("notes")
      expect(top(ui)).toContain("notes")
      await run("ls")
      expect(api().state().commandMessage ?? "").toContain("Chill")
      expect(api().state().commandMessage ?? "").toContain("notes")
    } finally {
      await ui.dispose()
    }
  })

  test(":q closes the current buffer and lands on the previous one", async () => {
    const { ui, project, run } = await open()
    try {
      await project("notes")
      await project("atlas")
      expect(top(ui)).toContain("atlas")
      await run("q")
      expect(top(ui)).toContain("notes")
      await run("q")
      expect(top(ui)).toContain("Chat")
    } finally {
      await ui.dispose()
    }
  })

  test(":qo keeps only the current buffer; :qa returns home", async () => {
    const { ui, project, run } = await open()
    try {
      await project("notes")
      await project("atlas")
      await run("qo")
      expect(top(ui)).toContain("atlas")
      await run("qa")
      expect(top(ui)).toContain("Chat")
      expect(top(ui)).not.toContain("atlas")
    } finally {
      await ui.dispose()
    }
  })

  test(":q on the last buffer is the home buffer, not an error", async () => {
    const { ui, run } = await open()
    try {
      await run("q")
      expect(top(ui)).toContain("Chat")
    } finally {
      await ui.dispose()
    }
  })

  test("a project lands in its chat, and its agents open settings", async () => {
    const { ui, run } = await open()
    try {
      await run("projects")
      await ui.press("n")
      await ui.type("atlas")
      await ui.press("return")
      await ui.press("return")
      await ui.press("down")
      await ui.press("return")
      await ui.type("planner")
      await ui.press("return")
      await ui.press("escape")
      // Creation lands on the Agents screen, staffed, behind the prompt.
      expect(top(ui)).toContain("atlas")
      expect(ui.frame()).toContain("AGENTS")

      // Reopening the project from Projects lands in its chat.
      await run("q")
      await run("projects")
      await ui.press("return")
      expect(top(ui)).toContain("atlas")
      expect(ui.frame()).toContain("what do you want to learn today")

      // Agents is a menu: Enter opens the selected agent's settings window.
      await run("agents")
      expect(ui.frame()).toContain("AGENTS")
      await ui.press("return")
      const settings = ui.frame()
      expect(settings).toContain("Permissions")
      expect(settings).toContain("Model")
      // Model is a highlighted choice, not a text field.
      await ui.press("j")
      await ui.press("j")
      await ui.press("return")
      expect(ui.frame()).toContain("openai/gpt-4.1-mini")
      await ui.press("down")
      await ui.press("return")
      expect(ui.frame()).toContain("openai/gpt-4.1")
    } finally {
      await ui.dispose()
    }
  })

  test("a duplicate agent name is refused in a notice, and e edits", async () => {
    const { ui, run } = await open()
    try {
      await run("projects")
      await ui.press("n")
      await ui.type("atlas")
      await ui.press("return")
      await ui.press("return")
      await ui.press("down")
      await ui.press("return")
      await ui.type("planner")
      await ui.press("return")
      await ui.type("PLANNER")
      await ui.press("return")
      const frame = ui.frame()
      expect(frame).toContain("already exists")
      // The prompt stays open, so a second name can be typed.
      expect(frame).toContain("Agent in atlas")
      await ui.type("writer")
      await ui.press("return")
      await ui.press("escape")
      const list = ui.frame()
      expect(list).toContain("planner")
      expect(list).toContain("writer")
      // The footer promises `e edit`, and it works.
      await ui.press("e")
      expect(ui.frame()).toContain("Permissions")
    } finally {
      await ui.dispose()
    }
  })

  test("␣ 0 closes the current buffer, but Esc never does", async () => {
    const { ui, project } = await open()
    try {
      await project("notes")
      await ui.press("space")
      await ui.press("0")
      expect(top(ui)).toContain("Chat")
      await project("atlas")
      await ui.press("escape")
      // Esc backs out of menus and readers; the buffer stays.
      expect(top(ui)).toContain("atlas")
      expect(top(ui)).toContain("2/2")
      await ui.press("space")
      await ui.press("0")
      expect(top(ui)).toContain("Chat")
      expect(top(ui)).not.toContain("atlas")
    } finally {
      await ui.dispose()
    }
  })
})

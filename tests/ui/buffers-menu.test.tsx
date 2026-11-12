/**
 * `␣ b` lists the buffers. Enter switches what is behind the menu and the menu
 * stays up, `d` closes an entry and the menu stays up, and only Esc dismisses it.
 */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")

async function open() {
  const ui = await renderApp({ width: 140, height: 30, app: () => <App initial={{ pane: "projects" } as never} /> })
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
  return { ui, run, project }
}

const top = (ui: { frame: () => string }) => ui.frame().split("\n")[0] ?? ""

describe("the buffers menu", () => {
  test("␣ b opens it, and it lists what is open", async () => {
    const { ui, project } = await open()
    try {
      await project("notes")
      await ui.press("space")
      await ui.press("b")
      const frame = ui.frame()
      expect(frame).toContain("BUFFERS")
      expect(frame).toContain("Chill")
      expect(frame).toContain("notes")
      expect(frame).toContain("current")
    } finally {
      await ui.dispose()
    }
  })

  test("Enter switches to the selected buffer and the menu stays until Esc", async () => {
    const { ui, project } = await open()
    try {
      await project("notes")
      await ui.press("space")
      await ui.press("b")
      // Home is first; move to notes and open it.
      await ui.press("j")
      await ui.press("return")
      expect(top(ui)).toContain("notes")
      // The manager is still up: Esc is what closes it.
      expect(ui.frame()).toContain("BUFFERS")
      await ui.press("escape")
      expect(ui.frame()).not.toContain("BUFFERS")
      expect(top(ui)).toContain("notes")
    } finally {
      await ui.dispose()
    }
  })

  test("d closes the selected buffer without closing the current one", async () => {
    const { ui, project } = await open()
    try {
      await project("notes")
      await project("atlas")
      await ui.press("space")
      await ui.press("b")
      // Close the middle buffer (notes), leaving the current one open.
      await ui.press("j")
      await ui.press("d")
      // Closing an entry leaves the manager open, like the editor it borrows from.
      expect(ui.frame()).toContain("BUFFERS")
      await ui.press("escape")
      const frame = ui.frame()
      expect(frame).not.toContain("notes")
      expect(top(ui)).toContain("atlas")
    } finally {
      await ui.dispose()
    }
  })
})

/** A paste becomes a labelled chip, not a burst of typed lines. */
import { describe, expect, test } from "bun:test"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")

async function open() {
  const ui = await renderApp({ width: 110, height: 30, app: () => <App /> })
  await ui.waitFor("LOCKEDIN")
  await ui.press("i")
  return ui
}

describe("pasting into the composer", () => {
  test("multi-line text becomes a line-count chip", async () => {
    const ui = await open()
    try {
      await ui.mockInput.pasteBracketedText("alpha\nbeta\ngamma")
      await ui.idle(5)
      const frame = ui.frame()
      expect(frame).toContain("[pasted 3 lines]")
      expect(frame).not.toContain("alpha\nbeta")
      // Backspace with an empty draft removes the chip, not the message.
      await ui.press("backspace")
      await ui.idle(4)
      expect(ui.frame()).not.toContain("[pasted 3 lines]")
    } finally {
      await ui.dispose()
    }
  })
})

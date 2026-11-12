import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"

import { App } from "../src/app/App"

describe("scaffold", () => {
  test.serial("renders the shell", async () => {
    const setup = await testRender(() => <App />, { width: 100, height: 24 })
    try {
      await setup.waitForFrame((frame) => frame.includes("LOCKEDIN"), {
        maxPasses: 40,
      })
      const frame = setup.captureCharFrame()
      expect(frame).toContain("a terminal workspace for learning")
      expect(frame).toContain("NORMAL")
      expect(frame).toContain("no model")
    } finally {
      await setup.dispose()
    }
  })
})

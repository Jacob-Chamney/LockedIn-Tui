/** Saved keybinds are applied to the registry before the shell takes keys. */
import { expect, test } from "bun:test"

import { renderApp } from "../helpers/render"

const { App } = await import("../../src/app/App")

test("a saved binding is in force from the first frame", async () => {
  const ui = await renderApp({
    width: 100,
    height: 32,
    app: () => (
      <App
        keybinds={{ keybinds: { help: "space+z" }, fixed_keybinds: {} }}
      />
    ),
  })
  try {
    await ui.press("space")
    await ui.press("z")
    await ui.waitUntil(() => ui.frame().includes("HELP"))
    expect(ui.frame()).toContain("HELP")
  } finally {
    await ui.dispose()
  }
})

/** Inline Settings controls change the view and save one patch. */
import { expect, test } from "bun:test"

import { App } from "../../src/app/App"
import { renderApp } from "../helpers/render"

async function openSettings(patches: Record<string, unknown>[]) {
  const ui = await renderApp({
    width: 120,
    height: 36,
    app: () => (
      <App
        initial={{ pane: "settings", focus: "chat", mode: "normal" } as never}
        onConfigPatch={async (patch: Record<string, unknown>) => {
          patches.push(patch)
          return { ok: true, value: {} } as never
        }}
      />
    ),
  })
  await ui.waitFor("SETTINGS")
  return ui
}

test("period cycles and pause toggles from their rows", async () => {
  const patches: Record<string, unknown>[] = []
  const ui = await openSettings(patches)
  try {
    // username, theme, chat settings, providers, chat model, base URL,
    // max tool calls, max tokens, budget, period.
    for (let step = 0; step < 9; step++) await ui.press("down")
    await ui.press("enter")
    await ui.waitUntil(() => patches.some((patch) => "usage" in patch))
    expect(patches.some((patch) => "usage" in patch && "period" in (patch.usage as object))).toBe(true)

    await ui.press("down") // warn at: use + on the next press
    await ui.press("+")
    await ui.waitUntil(() => patches.some((patch) => "usage" in patch && "warn_at" in (patch.usage as object)))

    await ui.press("down") // pause at limit
    await ui.press("enter")
    await ui.waitUntil(() =>
      patches.some((patch) => "usage" in patch && "pause_at_limit" in (patch.usage as object)),
    )
  } finally {
    await ui.dispose()
  }
})

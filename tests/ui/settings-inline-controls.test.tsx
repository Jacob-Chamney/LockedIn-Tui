/** Adjustable Settings rows open with Enter and move with arrows/hjkl. */
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

test("period, warn-at and pause adjust after Enter with hjkl", async () => {
  const patches: Record<string, unknown>[] = []
  const ui = await openSettings(patches)
  try {
    // username, theme, chat settings, providers, chat model, base URL,
    // max tool calls, max tokens, budget, period.
    for (let step = 0; step < 9; step++) await ui.press("down")
    await ui.press("enter") // open period for adjustment
    await ui.press("l") // increment/toggle
    await ui.waitUntil(() => patches.some((patch) => "usage" in patch && "period" in (patch.usage as object)))
    await ui.press("enter") // done

    await ui.press("down") // warn at
    await ui.press("enter")
    await ui.press("j")
    await ui.waitUntil(() =>
      patches.some((patch) => "usage" in patch && "warn_at" in (patch.usage as object)),
    )
    await ui.press("enter")

    await ui.press("down") // pause at limit
    await ui.press("enter")
    await ui.press("k")
    await ui.waitUntil(() =>
      patches.some((patch) => "usage" in patch && "pause_at_limit" in (patch.usage as object)),
    )
    await ui.press("enter")
  } finally {
    await ui.dispose()
  }
})

test("plus and minus do not adjust a row", async () => {
  const patches: Record<string, unknown>[] = []
  const ui = await openSettings(patches)
  try {
    for (let step = 0; step < 8; step++) await ui.press("down") // budget
    await ui.press("+")
    await ui.press("-")
    expect(patches.some((patch) => "usage" in patch && "budget" in (patch.usage as object))).toBe(false)
  } finally {
    await ui.dispose()
  }
})

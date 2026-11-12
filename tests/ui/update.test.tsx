/** The update badge and the `:update` command, through the real shell. */
import { describe, expect, test } from "bun:test"

import { renderApp } from "../helpers/render"

const { App } = await import("../../src/app/App")
import type { UpdateInfo, UpdateService } from "../../src/services/update"

const INFO: UpdateInfo = {
  version: "9.9.9",
  asset: "lockedin-9.9.9-bun-linux-x64",
  assetUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v9.9.9/a",
  checksumUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v9.9.9/SHA256SUMS",
  releaseUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/tag/v9.9.9",
}

function service(overrides: Partial<UpdateService> = {}): UpdateService {
  return {
    check: async () => ({ kind: "available", current: "1.0.0", info: INFO }),
    install: async () => ({ kind: "updated", version: "9.9.9" }),
    ...overrides,
  }
}

async function mount(service: UpdateService | undefined, initial: Record<string, unknown> = {}) {
  return renderApp({
    width: 120,
    height: 36,
    app: () => (
      <App update={service ? async () => service : undefined} initial={initial as never} />
    ),
  })
}

describe("update availability", () => {
  test("shows a persistent top-bar badge and a notice", async () => {
    const ui = await mount(service())
    try {
      await ui.waitUntil(() => ui.frame().includes("9.9.9"))
      const frame = ui.frame()
      expect(frame).toContain("↑ 9.9.9 · :update")
      expect(frame).toContain("is available")
    } finally {
      await ui.dispose()
    }
  })

  test("a current release shows nothing", async () => {
    const ui = await mount(
      service({ check: async () => ({ kind: "current", current: "1.0.0", latest: "1.0.0" }) }),
    )
    try {
      await ui.idle()
      expect(ui.frame()).not.toContain(":update")
    } finally {
      await ui.dispose()
    }
  })
})

describe(":update", () => {
  test("installs and asks for a restart", async () => {
    let installed = false
    const ui = await mount(
      service({
        install: async () => {
          installed = true
          return { kind: "updated", version: "9.9.9" }
        },
      }),
      { overlay: "command", mode: "insert", commandQuery: "update" },
    )
    try {
      await ui.waitUntil(() => ui.frame().includes(":update"))
      await ui.press("enter")
      await ui.waitUntil(() => ui.frame().includes("restart for 9.9.9"))
      expect(installed).toBe(true)
      expect(ui.frame()).toContain("updated to 9.9.9")
    } finally {
      await ui.dispose()
    }
  })

  test("without an updater the command explains why", async () => {
    const ui = await mount(undefined, {
      overlay: "command",
      mode: "insert",
      commandQuery: "update",
    })
    try {
      await ui.press("enter")
      await ui.waitUntil(() => ui.frame().includes("updates are only available"))
    } finally {
      await ui.dispose()
    }
  })
})

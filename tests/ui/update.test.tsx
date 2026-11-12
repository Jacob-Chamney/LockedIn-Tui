/** The update badge and the `:update` command, through the real shell. */
import { describe, expect, test } from "bun:test"

import { renderApp } from "../helpers/render"

const { App } = await import("../../src/app/App")
import type { UpdateInfo, UpdateService } from "../../src/services/update"

const INFO: UpdateInfo = {
  version: "2026.12.01",
  asset: "lockedin-2026.12.01-bun-linux-x64",
  assetUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v2026.12.01/a",
  checksumUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/download/v2026.12.01/SHA256SUMS",
  releaseUrl: "https://github.com/Jacob-Chamney/LockedIn-Tui/releases/tag/v2026.12.01",
}

function service(overrides: Partial<UpdateService> = {}): UpdateService {
  return {
    check: async () => ({ kind: "available", current: "2026.11.12", info: INFO }),
    install: async () => ({ kind: "updated", version: "2026.12.01" }),
    ...overrides,
  }
}

async function mount(
  service: UpdateService | undefined,
  initial: Record<string, unknown> = {},
  restart?: (prepare: () => void) => { ok: boolean; message?: string },
) {
  return renderApp({
    width: 120,
    height: 36,
    app: () => (
      <App
        update={service ? async () => service : undefined}
        restart={restart}
        initial={initial as never}
      />
    ),
  })
}

describe("update availability", () => {
  test("shows a persistent top-bar badge and a notice", async () => {
    const ui = await mount(service())
    try {
      await ui.waitUntil(() => ui.frame().includes("2026.12.01"))
      const frame = ui.frame()
      expect(frame).toContain("↑ 2026.12.01 · :update")
      expect(frame).toContain("is available")
    } finally {
      await ui.dispose()
    }
  })

  test("a current release shows nothing", async () => {
    const ui = await mount(
      service({ check: async () => ({ kind: "current", current: "2026.11.12", latest: "2026.11.12" }) }),
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
          return { kind: "updated", version: "2026.12.01" }
        },
      }),
      { overlay: "command", mode: "insert", commandQuery: "update" },
    )
    try {
      await ui.waitUntil(() => ui.frame().includes(":update"))
      await ui.press("enter")
      await ui.waitUntil(() => ui.frame().includes("restart for 2026.12.01"))
      expect(installed).toBe(true)
      expect(ui.frame()).toContain("updated to 2026.12.01")
    } finally {
      await ui.dispose()
    }
  })

  test("restarts in place after installing", async () => {
    let restarted = false
    const ui = await mount(
      service(),
      { overlay: "command", mode: "insert", commandQuery: "update" },
      (prepare) => {
        expect(typeof prepare).toBe("function")
        restarted = true
        return { ok: true }
      },
    )
    try {
      await ui.waitUntil(() => ui.frame().includes(":update"))
      await ui.press("enter")
      await ui.waitUntil(() => ui.frame().includes("restarting"))
      expect(ui.frame()).toContain("restarting")
      await ui.waitUntil(() => restarted)
      expect(restarted).toBe(true)
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

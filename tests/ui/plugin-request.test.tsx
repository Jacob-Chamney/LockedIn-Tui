/** Host confirm/prompt/menu overlays. */
import { expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const { PluginRequestOverlay } = await import("../../src/ui/overlays/plugin-request")
const { crimson } = await import("../../src/ui/theme")

test("a plugin menu renders its options with a cursor", async () => {
  const setup = await testRender(
    () => (
      <PluginRequestOverlay
        theme={crimson}
        width={80}
        height={24}
        request={{ kind: "menu", title: "pick", options: ["one", "two"], index: 1 }}
      />
    ),
    { width: 80, height: 24 },
  )
  try {
    await setup.flush()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("pick")
    expect(frame).toContain("one")
    expect(frame).toContain("▸ two")
  } finally {
    await setup.dispose()
  }
})

test("a confirm and a prompt render their messages", async () => {
  for (const request of [
    { kind: "confirm" as const, message: "delete this?", confirmLabel: "delete", cancelLabel: "keep" },
    { kind: "prompt" as const, message: "name?", value: "draft", placeholder: "untitled" },
  ]) {
    const setup = await testRender(
      () => <PluginRequestOverlay theme={crimson} width={80} height={24} request={request} />,
      { width: 80, height: 24 },
    )
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain(request.kind === "confirm" ? "delete this?" : "draft")
    } finally {
      await setup.dispose()
    }
  }
})

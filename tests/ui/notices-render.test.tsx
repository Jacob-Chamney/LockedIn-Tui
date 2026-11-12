/** The error notice is a rounded bubble with its message inside. */
import { expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const { NoticeStack } = await import("../../src/ui/shell/notice-stack")
const { crimson } = await import("../../src/ui/theme")

test("an error renders as a rounded bubble with the message", async () => {
  const setup = await testRender(
    () => (
      <NoticeStack
        theme={crimson}
        width={60}
        notices={[
          { id: "n1", text: "model request failed", level: "error", at: 0 },
        ]}
        now={0}
      />
    ),
    { width: 60, height: 12 },
  )
  try {
    await setup.flush()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("╭")
    expect(frame).toContain("╮")
    expect(frame).toContain("×")
    expect(frame).toContain("model request failed")
  } finally {
    await setup.dispose()
  }
})

/** The top bar renders the trail as fitted breadcrumbs. */
import { expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const { TopBar } = await import("../../src/ui/shell/layout")
const { crimson } = await import("../../src/ui/theme")

async function mount(width: number) {
  const setup = await testRender(
    () => (
      <TopBar
        theme={crimson}
        width={width}
        context="LEARN"
        active="Physics unit 4"
        paneTitle="Chat"
      />
    ),
    { width, height: 2 },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

test("a wide bar keeps every crumb", async () => {
  const setup = await mount(120)
  try {
    expect(setup.captureCharFrame()).toContain("LEARN › Physics unit 4 › Chat")
  } finally {
    await setup.dispose()
  }
})

test("a narrow bar elides the root and keeps the current crumb", async () => {
  const setup = await mount(50)
  try {
    const frame = setup.captureCharFrame()
    expect(frame).toContain("… › Chat")
    expect(frame).not.toContain("Physics unit 4")
  } finally {
    await setup.dispose()
  }
})

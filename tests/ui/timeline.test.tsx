/** The timeline stays inside very narrow surfaces. */
import { expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const { Timeline } = await import("../../src/ui/shell/timeline")
const { crimson } = await import("../../src/ui/theme")

async function mount(width: number, height: number) {
  const setup = await testRender(
    () => (
      <Timeline
        theme={crimson}
        width={width}
        entries={[
          { time: "10:00", label: "a long label", detail: "failed run" },
          { time: "11:00", label: "second" },
        ]}
        selectable
        selected={0}
      />
    ) as never,
    { width, height },
  )
  await setup.flush()
  return setup
}

test("narrow timelines never draw past their width", async () => {
  for (const width of [1, 2, 3, 4, 5, 6]) {
    const setup = await mount(width, 6)
    try {
      for (const line of setup.captureCharFrame().split("\n")) {
        expect(line.length).toBeLessThanOrEqual(width)
      }
    } finally {
      await setup.dispose()
    }
  }
})

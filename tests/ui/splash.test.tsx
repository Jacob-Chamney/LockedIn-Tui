/** The startup splash renders the wordmark and can be skipped. */
import { expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const { StartupSplash } = await import("../../src/ui/shell/splash")
const { crimson } = await import("../../src/ui/theme")

test("the splash paints the wordmark and a lock", async () => {
  let done = 0
  const setup = await testRender(
    () => <StartupSplash palette={crimson} onDone={() => { done += 1 }} />,
    { width: 80, height: 24 },
  )
  try {
    await setup.flush()
    await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
    const frame = setup.captureCharFrame()
    expect(frame).toContain("LOCKEDIN")
    expect(frame).toContain("learning, locked in")
    expect(frame).toContain("Esc to skip")
    expect(frame).toMatch(/assembling|unlocked|locking|locked/)
  } finally {
    await setup.dispose()
  }
})

test("Escape skips the splash immediately", async () => {
  let done = 0
  const setup = await testRender(
    () => <StartupSplash palette={crimson} onDone={() => { done += 1 }} />,
    { width: 80, height: 24, kittyKeyboard: true },
  )
  try {
    await setup.flush()
    await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
    setup.mockInput.pressKey("ESCAPE", {})
    await setup.flush()
    await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
    expect(done).toBe(1)
  } finally {
    await setup.dispose()
  }
})

test("the app mounts only after the splash", async () => {
  const { StartupGate } = await import("../../src/ui/shell/splash")
  let mounts = 0
  const setup = await testRender(
    () => (
      <StartupGate
        enabled
        palette={crimson}
        app={() => {
          mounts += 1
          return <text>APP READY</text>
        }}
      />
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  try {
    await setup.flush()
    expect(mounts).toBe(0)
    expect(setup.captureCharFrame()).toContain("LOCKEDIN")
    setup.mockInput.pressKey("ESCAPE", {})
    await setup.flush()
    expect(mounts).toBe(1)
    expect(setup.captureCharFrame()).toContain("APP READY")
  } finally {
    await setup.dispose()
  }
})

test("renders a full 200x60 field", async () => {
  const setup = await testRender(
    () => <StartupSplash palette={crimson} onDone={() => {}} />,
    { width: 200, height: 60 },
  )
  try {
    await setup.flush()
    await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
    const frame = setup.captureCharFrame()
    expect(frame).toContain("LOCKEDIN")
    expect(frame.split("\n").length).toBeGreaterThanOrEqual(59)
  } finally {
    await setup.dispose()
  }
})

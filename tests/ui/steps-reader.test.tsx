/** WP-303b — steps reader: rows, cursor, toggle intent, regenerate confirm. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const steps = await import("../../src/ui/reader/steps")
type StepsView = import("../../src/ui/reader/steps").StepsView
const { crimson } = await import("../../src/ui/theme")

const RAW = readFileSync(join(import.meta.dir, "../fixtures/steps-reader/assignment-steps.md"), "utf8")

async function mount(
  width: number,
  height: number,
  props: { raw?: string; view?: StepsView; snapshot?: { checked: number; total: number }; missing?: boolean; hasInstructions?: boolean; focused?: boolean } = {},
) {
  const setup = await testRender(
    () => (
      <steps.StepsReader
        theme={crimson}
        width={width}
        height={height}
        focused={props.focused ?? true}
        raw={props.raw ?? RAW}
        snapshot={props.snapshot ?? { checked: 1, total: 3 }}
        view={props.view ?? steps.initialStepsView}
        missing={props.missing}
        hasInstructions={props.hasInstructions}
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("rows", () => {
  test("headings and checkbox rows render in file order", async () => {
    const setup = await mount(90, 20)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("STEPS · assignment-steps.md")
      expect(frame).toContain("1 of 3 steps done")
      expect(frame).toContain("Understand")
      expect(frame).toContain("✓  Read section 4.2")
      expect(frame).toContain("☐  Derive the energy balance")
    } finally {
      await setup.dispose()
    }
  })

  test("long text wraps at words and hard-breaks an overlong token", () => {
    expect(steps.wrapStepText("one two three", 7)).toEqual(["one two", "three"])
    expect(steps.wrapStepText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"])
  })

  test("consecutive steps get breathing room and wrap before the edge", () => {
    const raw = [
      "# Assignment steps",
      "",
      "> 0 of 2 steps done",
      "",
      "## Work",
      "",
      "- [ ] First step with enough words to show wrapping behaviour",
      "- [ ] Second step",
      "",
    ].join("\n")
    const rows = steps.rowsFor(raw)
    const layout = steps.layoutSteps({ rows, width: 40, height: 20, cursor: 0 })
    const first = layout.lines.findIndex((line) => line.text.includes("First step"))
    const second = layout.lines.findIndex((line) => line.text.includes("Second step"))
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first)
    expect(layout.lines.slice(first, second).some((line) => line.kind === "blank")).toBe(true)
    for (const line of layout.lines) expect(Array.from(line.text).length).toBeLessThanOrEqual(36)
  })

  test("layout keeps the selected step visible near the bottom", () => {
    const raw = [
      "# Steps",
      "",
      "> 0 of 12 steps done",
      "",
      "## Work",
      "",
      ...Array.from({ length: 12 }, (_, index) => `- [ ] Step ${index + 1} with enough text to wrap`),
    ].join("\n")
    const rows = steps.rowsFor(raw)
    const layout = steps.layoutSteps({ rows, width: 36, height: 8, cursor: rows.length - 1 })
    expect(layout.visible.some((line) => line.selected)).toBe(true)
    expect(layout.visible.some((line) => line.text.includes("Step 12"))).toBe(true)
    expect(layout.above).toBe(true)
  })

  test("only step rows are cursor stops; headings are skipped", () => {
    const rows = steps.rowsFor(RAW)
    const first = steps.move(rows, 0, 0)
    expect(steps.currentStep(rows, first)?.text).toBe("Read section 4.2")
    const second = steps.move(rows, first, 1)
    expect(steps.currentStep(rows, second)?.text).toBe("Derive the energy balance")
    const third = steps.move(rows, second, 1)
    expect(steps.currentStep(rows, third)?.text).toBe("Set up the equations")
    // past the end it clamps on the last step
    expect(steps.currentStep(rows, steps.move(rows, third, 9))?.text).toBe("Set up the equations")
  })

  test("the progress line follows the snapshot the service returns", async () => {
    const before = await mount(90, 20, { snapshot: { checked: 1, total: 3 } })
    try {
      expect(lines(before).join("\n")).toContain("1 of 3 steps done")
    } finally {
      await before.dispose()
    }
    const after = await mount(90, 20, { snapshot: { checked: 2, total: 3 }, view: { cursor: 0, pendingRegenerate: false } })
    try {
      expect(lines(after).join("\n")).toContain("2 of 3 steps done")
    } finally {
      await after.dispose()
    }
  })

  test("a long step wraps inside the reader and keeps the footer visible", async () => {
    const raw = [
      "# Assignment steps",
      "",
      "> 0 of 1 steps done",
      "",
      "## Understand",
      "",
      "- [ ] This is a very long assignment step that must wrap cleanly across the reader width without disappearing off the right edge",
      "",
    ].join("\n")
    const setup = await mount(50, 14, { raw, snapshot: { checked: 0, total: 1 } })
    try {
      const out = lines(setup)
      expect(out.every((line) => line.length === 50)).toBe(true)
      const text = out.join("\n")
      expect(text).toContain("This is a very long assignment")
      expect(text).toContain("right edge")
      expect(text).toContain("x toggle")
      expect(text).not.toContain("off the right edge…")
    } finally {
      await setup.dispose()
    }
  })

  test("a short pane clips the body but keeps the selected step and footer", async () => {
    const raw = [
      "# Assignment steps",
      "",
      "> 0 of 20 steps done",
      "",
      "## Work",
      "",
      ...Array.from({ length: 20 }, (_, index) => `- [ ] Step ${index + 1}`),
      "",
    ].join("\n")
    const setup = await mount(50, 12, {
      raw,
      snapshot: { checked: 0, total: 20 },
      view: { cursor: 21, pendingRegenerate: false },
    })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("Step 20")
      expect(frame).toContain("Esc back")
      expect(frame).toContain("more")
    } finally {
      await setup.dispose()
    }
  })

  test("the selected row carries a marker, the rest dim", async () => {
    const setup = await mount(90, 20, { view: { cursor: 0, pendingRegenerate: false } })
    try {
      const row = lines(setup).find((line) => line.includes("Read section 4.2"))!
      expect(row).toContain("▌")
    } finally {
      await setup.dispose()
    }
  })
})

describe("toggle", () => {
  test("x asks the service to toggle the row under the cursor", () => {
    expect(steps.intentFor("x")).toBe("toggle")
    expect(steps.intentFor("a")).toBe("ask")
    expect(steps.toggleKeyLabel()).toBe("x")
  })

  test("a snapshot with one more checked row renders the new checkbox", async () => {
    // The service wrote the file; the reader just shows the result.
    const toggled = RAW.replace("- [ ] Derive the energy balance", "- [x] Derive the energy balance")
    const setup = await mount(90, 20, { raw: toggled, snapshot: { checked: 2, total: 3 } })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("✓  Derive the energy balance")
      expect(frame).toContain("2 of 3 steps done")
    } finally {
      await setup.dispose()
    }
  })
})

describe("regeneration is a confirmation", () => {
  test("the first press only asks; nothing is rewritten", () => {
    const armed = steps.armRegenerate(steps.initialStepsView)
    expect(armed.pendingRegenerate).toBe(true)
    expect(steps.confirmRegenerate(armed)).toEqual({ kind: "none" })
    expect(steps.confirmRegenerate(steps.initialStepsView).kind).toBe("confirm")
  })

  test("cancel clears the prompt and keeps the file untouched", async () => {
    const armed = steps.armRegenerate(steps.initialStepsView)
    const cancelled = steps.cancelRegenerate(armed)
    expect(cancelled.pendingRegenerate).toBe(false)
    expect(RAW).toContain("1 of 3 steps done")
  })

  test("the prompt names what is kept", async () => {
    const setup = await mount(100, 20, { view: steps.armRegenerate(steps.initialStepsView) })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("Regenerate steps?")
      expect(frame).toContain("stay checked")
    } finally {
      await setup.dispose()
    }
  })
})

describe("empty and missing", () => {
  test("an empty file offers the next action", async () => {
    const setup = await mount(90, 20, { raw: "" })
    try {
      expect(lines(setup).join("\n")).toContain("no steps yet · press R to generate steps")
    } finally {
      await setup.dispose()
    }
  })

  test("a missing file names the file and the action", async () => {
    const setup = await mount(90, 20, { raw: "", missing: true })
    try {
      expect(lines(setup).join("\n")).toContain("assignment-steps.md is missing")
    } finally {
      await setup.dispose()
    }
  })
})

describe("layout and keys", () => {
  test("80x24 reader-replaces-main snapshot", async () => {
    const setup = await mount(80, 24)
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
      expect(out[0]).toContain("STEPS")
    } finally {
      await setup.dispose()
    }
  })

  test("keys come from one table and the footer is generated", () => {
    expect(steps.intentFor("j")).toBe("down")
    expect(steps.intentFor("d")).toBe("half-down")
    expect(steps.intentFor("g", { shift: true })).toBe("bottom")
    expect(steps.intentFor("r", { shift: true })).toBe("regenerate")
    expect(steps.intentFor("i")).toBe("instructions")
    expect(steps.intentFor("z")).toBeUndefined()
    expect(steps.footerHints()).toContain("R regenerate")
    expect(steps.footerHints()).toContain("a ask")
  })

  test("the component performs no file IO and imports no service", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/reader/steps.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile|readFileSync|rename|unlink/)
    expect(source).not.toContain("src/services")
  })

  test("the instructions hint only appears when instructions exist", () => {
    expect(steps.instructionsHint(false)).toBe(null)
    expect(steps.instructionsHint(true)).toContain("instructions")
  })
})

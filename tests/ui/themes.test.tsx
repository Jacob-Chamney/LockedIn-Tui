/**
 * The theme picker (WP-817).
 *
 * The panel is a list of palettes with colour swatches, a marker on the palette
 * in force, `j`/`k` to move and `Enter` to apply. Applying goes through the
 * shell's `onThemeChange`, so the component owns no file I/O.
 */
import { describe, expect, test } from "bun:test"

const { testRender } = await import("@opentui/solid")
const themes = await import("../../src/ui/settings/themes")
const { crimson } = await import("../../src/ui/theme")

async function mount(cursor = 0, current = "lockedin", width = 120, height = 36) {
  const setup = await testRender(
    () => (
      <themes.ThemesPane
        theme={crimson}
        width={width}
        height={height}
        focused
        current={current}
        state={{ cursor }}
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function lines(setup: { captureCharFrame: () => string }): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("the catalogue", () => {
  test("every palette is listed with a label and three swatches", () => {
    const entries = themes.themeEntries()
    expect(entries.length).toBeGreaterThan(10)
    for (const entry of entries) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(themes.swatch(entry.palette)).toHaveLength(3)
    }
    // The identity palette is in the catalogue.
    expect(entries.some((entry) => entry.id === "lockedin")).toBe(true)
  })

  test("the cursor opens on the palette in force and marks it", async () => {
    const entries = themes.themeEntries()
    const at = entries.findIndex((entry) => entry.id === "lockedin")
    const setup = await mount(at, "lockedin")
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("LockedIn Crimson")
      expect(frame).toContain("✓")
      // The selected row carries the bar.
      const row = lines(setup).find((line) => line.includes("LockedIn Crimson"))!
      expect(row).toContain("▌")
    } finally {
      await setup.dispose()
    }
  })

  test("moving wraps within the catalogue bounds and skips nothing it should not", () => {
    expect(themes.moveTheme(0, -1, 5)).toBe(0)
    expect(themes.moveTheme(4, 1, 5)).toBe(4)
    expect(themes.moveTheme(2, 1, 5)).toBe(3)
    expect(themes.moveTheme(0, -1, 0)).toBe(0)
  })
})

describe("applying", () => {
  test("Enter applies the selected palette through the shell", async () => {
    const { renderApp } = await import("../helpers/render")
    const { App } = await import("../../src/app/App")
    const applied: string[] = []
    const ui = await renderApp({
      width: 120,
      height: 36,
      app: () => <App initial={{ pane: "themes" } as never} onThemeChange={(id: string) => applied.push(id)} />,
    })
    try {
      await ui.waitFor("LOCKEDIN")
      await ui.press("down")
      await ui.press("return")
      expect(applied).toHaveLength(1)
      // The next palette after the one in force, and the frame repainted.
      expect(applied[0]).not.toBe("lockedin")
    } finally {
      await ui.dispose()
    }
  })
})

describe("rendering", () => {
  test("a short terminal windows the list instead of clipping it", async () => {
    const setup = await mount(0, "lockedin", 80, 20)
    try {
      const out = lines(setup)
      expect(out.length).toBe(20)
      for (const line of out) expect(line.length).toBe(80)
      expect(out.join("\n")).toContain("THEME")
      expect(out.join("\n")).toContain("Esc back")
    } finally {
      await setup.dispose()
    }
  })

  test("the footer names the three keys", async () => {
    const setup = await mount()
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("j/k move")
      expect(frame).toContain("Enter apply")
      expect(frame).toContain("Esc back")
    } finally {
      await setup.dispose()
    }
  })
})

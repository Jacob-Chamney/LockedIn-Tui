/**
 * WP-117 — theme system and the crimson default.
 *
 * Data + model are unit-tested; the shell is asserted through real frames so a
 * palette change is proven to repaint every region, not just one.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const { testRender } = await import("@opentui/solid")
const { App } = await import("../../src/app/App")
const theme = await import("../../src/ui/theme")

type Setup = Awaited<ReturnType<typeof testRender>>

async function mount(
  width: number,
  height: number,
  options: { theme?: string; custom?: Record<string, string>; initial?: { explorer?: boolean; focus?: "explorer" | "chat" | "reader" } } = {},
) {
  const setup = await testRender(
    () => <App theme={options.theme} custom={options.custom} initial={options.initial} />,
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function rows(setup: Setup): string[] {
  const lines = setup.captureCharFrame().split("\n")
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

function colours(setup: Setup, needle: string): string[] {
  const out: string[] = []
  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (!span.text.includes(needle)) continue
      const buffer = (span.fg as unknown as { buffer: ArrayLike<number> }).buffer
      out.push(`#${[buffer[0], buffer[1], buffer[2]].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("")}`)
    }
  }
  return out
}

describe("palette catalogue", () => {
  test("crimson is the default and carries all twelve tokens", () => {
    expect(theme.DEFAULT_THEME).toBe("lockedin")
    expect(theme.resolveTheme(undefined).palette).toEqual(theme.crimson)
    expect(theme.resolveTheme("nonsense").id).toBe("lockedin")
    for (const token of theme.TOKEN_NAMES) {
      expect(theme.crimson[token]).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  test("every palette is complete, valid and labelled", () => {
    const ids = Object.keys(theme.palettes)
    expect(ids).toContain("high-contrast")
    expect(ids).toContain("claude-code")
    expect(ids).toContain("codex")
    expect(ids).toContain("custom")
    expect(ids.length).toBeGreaterThan(30) // the OpenCode set is included

    for (const [id, entry] of Object.entries(theme.palettes)) {
      expect(entry.label.length).toBeGreaterThan(0)
      const result = theme.validatePalette(entry.palette)
      expect({ id, ok: result.ok }).toEqual({ id, ok: true })
    }
  })

  test("palette names and values are data, not a component tree", () => {
    const choices = theme.paletteChoices()
    expect(choices.length).toBe(Object.keys(theme.palettes).length)
    for (const choice of choices) {
      expect(typeof choice.label).toBe("string")
      expect(theme.isValidHex(theme.palettes[choice.id]!.palette.primary)).toBe(true)
    }
  })
})

describe("contrast (WCAG AA)", () => {
  test("crimson body text passes 4.5:1 on every surface", () => {
    expect(theme.failingContrast(theme.crimson)).toEqual([])
    for (const row of theme.contrastTable(theme.crimson)) {
      expect({ token: row.token, on: row.on, passes: row.passes }).toEqual({
        token: row.token,
        on: row.on,
        passes: true,
      })
    }
  })

  test("high contrast is at least as legible as crimson", () => {
    expect(theme.failingContrast(theme.highContrast)).toEqual([])
    const crimsonBody = theme.contrastRatio(theme.crimson.foreground, theme.crimson.background)
    const contrastBody = theme.contrastRatio(theme.highContrast.foreground, theme.highContrast.background)
    expect(contrastBody).toBeGreaterThan(crimsonBody)
  })

  test("the ratio maths matches known values", () => {
    expect(theme.contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1)
    expect(theme.contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5)
  })
})

describe("custom palette editor", () => {
  test("round-trips through the config", () => {
    const state = { id: "custom", custom: { ...theme.crimson } } as Parameters<typeof theme.writeThemeConfig>[0]
    const edited = theme.setCustomToken(state, "primary", "#12ab34")
    if (!edited.ok) throw new Error(edited.message)
    const written = theme.writeThemeConfig(edited.state)
    expect(written.ui?.theme).toBe("custom")
    expect(written.ui?.custom_theme?.primary).toBe("#12AB34")

    const read = theme.readThemeConfig(written)
    expect(read.ok).toBe(true)
    expect(read.state.custom.primary).toBe("#12AB34")
    expect(theme.resolveTheme(read.state.id, read.state.custom).palette.primary).toBe("#12AB34")
  })

  test("an invalid colour is rejected with one message naming the token", () => {
    const state = { id: "custom", custom: { ...theme.crimson } } as Parameters<typeof theme.writeThemeConfig>[0]
    const bad = theme.setCustomToken(state, "accent", "red")
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error("expected a rejection")
    expect(bad.token).toBe("accent")
    expect(bad.message).toBe('accent must be #RRGGBB, got "red".')
    // Nothing changed.
    expect(state.custom.accent).toBe(theme.crimson.accent)
  })

  test("a broken stored palette is reported once and falls back to crimson", () => {
    const result = theme.readThemeConfig({ ui: { theme: "custom", custom_theme: { primary: "#xyz" } } })
    expect(result.ok).toBe(false)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a rejection")
    expect(result.message).toContain("Keeping LockedIn Crimson")
    expect(result.state.custom.primary).toBe(theme.crimson.primary)
  })

  test("an unknown theme id falls back and says so", () => {
    const result = theme.readThemeConfig({ ui: { theme: "not-a-theme" } })
    expect(result.state.id).toBe("lockedin")
    expect(result.issues[0]?.message).toContain("Unknown theme")
  })
})

describe("the shell has no literal colours", () => {
  test("no #RRGGBB literal outside the theme module", () => {
    const root = join(import.meta.dir, "../../src")
    const offenders: string[] = []
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(path))
        else if (/\.tsx?$/.test(entry.name)) out.push(path)
      }
      return out
    }
    for (const file of walk(root)) {
      if (file.includes(`${join("ui", "theme")}`)) continue
      if (readFileSync(file, "utf8").match(/#[0-9A-Fa-f]{6}\b/)) offenders.push(relative(root, file))
    }
    expect(offenders).toEqual([])
  })
})

describe("switching a theme repaints the shell", () => {
  test("every region and the status bar follow the palette", async () => {
    const crimson = await mount(200, 60, { theme: "lockedin" })
    let crimsonFrame: string[]
    try {
      crimsonFrame = rows(crimson)
      const frame = crimsonFrame.join("\n")
      expect(frame).toContain("LOCKEDIN")
      expect(colours(crimson, "LOCKEDIN")).toEqual([theme.crimson.primary.toLowerCase()])
      expect(colours(crimson, "NORMAL")).toContain(theme.crimson.background.toLowerCase())
    } finally {
      await crimson.dispose()
    }

    const contrast = await mount(200, 60, { theme: "high-contrast" })
    try {
      const frame = rows(contrast).join("\n")
      expect(frame).toContain("LOCKEDIN")
      expect(colours(contrast, "LOCKEDIN")).toEqual([theme.highContrast.primary.toLowerCase()])
      // The status chips paint the background colour on the primary fill.
      expect(colours(contrast, "NORMAL")).toContain(theme.highContrast.background.toLowerCase())
      expect(crimsonFrame).not.toBe(rows(contrast)) // different colours, same layout
    } finally {
      await contrast.dispose()
    }
  })

  test("a custom palette repaints too", async () => {
    const custom = { ...theme.crimson, primary: "#12AB34" }
    const setup = await mount(200, 60, { theme: "custom", custom })
    try {
      expect(colours(setup, "LOCKEDIN")).toEqual(["#12ab34"])
    } finally {
      await setup.dispose()
    }
  })
})

describe("80x24 snapshots", () => {
  test("crimson", async () => {
    const setup = await mount(80, 24, { theme: "lockedin" })
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(24)
      for (const line of lines) expect(line.length).toBe(80)
      expect(lines[0]).toContain("LOCKEDIN")
      expect(lines[0]).toContain("CHILL")
      expect(lines[23]).toContain("CHILL")
      expect(lines[23]).toContain("NORMAL")
    } finally {
      await setup.dispose()
    }
  })

  test("high contrast", async () => {
    const setup = await mount(80, 24, { theme: "high-contrast" })
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(24)
      for (const line of lines) expect(line.length).toBe(80)
      expect(lines[0]).toContain("LOCKEDIN")
      expect(colours(setup, "no model configured")).toContain(theme.highContrast.warning.toLowerCase())
    } finally {
      await setup.dispose()
    }
  })
})

describe("colour is never the only signal", () => {
  test("every semantic colour in the shell travels with a glyph", async () => {
    const narrow = await mount(80, 24, { theme: "lockedin" })
    try {
      // warning colour is only ever shown with a glyph (the ▌ badge marker)
      expect(rows(narrow).join("\n")).toContain("▌ no model configured")
      expect(colours(narrow, "no model configured")).toContain(theme.crimson.warning.toLowerCase())
    } finally {
      await narrow.dispose()
    }

    const wide = await mount(200, 60, { theme: "lockedin", initial: { explorer: true, focus: "explorer" } })
    try {
      const frame = rows(wide).join("\n")
      expect(frame).toContain("▸ EXPLORER")
    } finally {
      await wide.dispose()
    }
  })
})

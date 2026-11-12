/** WP-701 — settings shell and the appearance section. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const settings = await import("../../src/ui/settings/appearance")
type AppearanceState = import("../../src/ui/settings/appearance").AppearanceState
const { crimson, highContrast, resolveTheme } = await import("../../src/ui/theme")

const app = (overrides: Partial<AppearanceState> = {}): AppearanceState => ({
  ...settings.initialAppearance(crimson),
  ...overrides,
})

async function mountPanel(width: number, height: number, state = app(), env: Record<string, string> = {}) {
  const setup = await testRender(
    () => (
      <settings.AppearancePanel theme={crimson} width={width} height={height} focused state={state} env={env} />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

async function mountList(width: number, height: number, router = settings.initialRouter) {
  const setup = await testRender(
    () => <settings.SettingsList theme={crimson} width={width} height={height} focused router={router} />,
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

describe("section shell", () => {
  test("six entries, unbuilt ones say so, saving hints differ", async () => {
    const setup = await mountList(100, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(settings.SECTIONS).toHaveLength(6)
      for (const section of settings.SECTIONS) expect(frame).toContain(section.label)
      expect(frame).toContain("models  · not built yet  Enter save")
      expect(frame).toContain("appearance  applies immediately")
      expect(settings.notBuiltCopy("models")).toContain("not built yet")
    } finally {
      await setup.dispose()
    }
  })

  test("Esc from a section lands back on the list with the previous cursor", () => {
    const moved = settings.moveCursor(settings.moveCursor(settings.initialRouter, 1), 1)
    expect(moved.cursor).toBe(2)
    const opened = settings.openSection(moved)
    expect(opened.pane).toBe("section")
    const closed = settings.closeSection(opened)
    expect(closed.pane).toBe("list")
    expect(closed.cursor).toBe(2)
    expect(closed.section).toBe(null)
  })

  test("the cursor cannot leave the list", () => {
    expect(settings.moveCursor(settings.initialRouter, -5).cursor).toBe(0)
    expect(settings.moveCursor(settings.initialRouter, 99).cursor).toBe(settings.SECTIONS.length - 1)
  })
})

describe("theme and semantics", () => {
  test("switching theme moves surface tokens but never the four semantic swatches", () => {
    const before = settings.semanticValues()
    const switched = settings.chooseTheme(app(), "high-contrast")
    expect(switched.theme).toBe("high-contrast")
    expect(settings.semanticValues()).toEqual(before)
    expect(settings.SEMANTIC_SWATCHES.map((swatch) => swatch.label)).toEqual(["success", "warning", "error", "accent"])

    const crimsonPreview = settings.themePreview("lockedin", crimson)
    const contrastPreview = settings.themePreview("high-contrast", crimson)
    expect(crimsonPreview.background).not.toBe(contrastPreview.background)
    expect(crimsonPreview.foreground).not.toBe(contrastPreview.foreground)
  })

  test("the preview is the resolved palette, including custom", () => {
    const custom = { ...crimson, primary: "#12AB34" }
    expect(settings.themePreview("custom", custom).primary).toBe("#12AB34")
    expect(resolveTheme("lockedin").palette).toEqual(crimson)
    expect(highContrast.background).toBe("#000000")
  })
})

describe("identity", () => {
  test("typing updates the preview and only Enter commits", async () => {
    const typed = settings.typeUsername(app(), "ada lovelace")
    expect(typed.username).toBe("friend")
    expect(typed.usernameDraft).toBe("ada lovelace")

    const setup = await mountPanel(120, 30, typed)
    try {
      expect(lines(setup).join("\n")).toContain("ada lovelace")
    } finally {
      await setup.dispose()
    }

    expect(settings.commitUsername(typed)).toEqual({
      kind: "patch",
      patch: { "ui.username": "ada lovelace" },
    })
  })

  test("an over-long username is refused and writes nothing", () => {
    const tooLong = settings.typeUsername(app(), "x".repeat(41))
    const result = settings.commitUsername(tooLong)
    expect(result.kind).toBe("refused")
    if (result.kind !== "refused") throw new Error("expected a refusal")
    expect(result.reason).toContain("at most 40 characters")
  })

  test("an invalid username colour names the field", () => {
    const result = settings.setUsernameColor(app(), "blue", crimson)
    if (result.kind !== "refused") throw new Error("expected a refusal")
    expect(result.reason).toContain("username colour must be #rrggbb")
  })

  test("a valid colour carries an AA label against the background", () => {
    expect(settings.usernameContrastLabel("#FFFFFF", crimson)).toContain("AA pass")
    expect(settings.usernameContrastLabel("#111111", crimson)).toContain("AA fail")
    const ok = settings.setUsernameColor(app(), "#ffffff", crimson)
    expect(ok.kind).toBe("patch")
  })
})

describe("custom palette", () => {
  test("an invalid hex is refused with the field named and nothing written", () => {
    const result = settings.editCustomToken(app(), "primary", "nope")
    if (!("kind" in result) || result.kind !== "refused") throw new Error("expected a refusal")
    expect(result.reason).toContain("primary must be #rrggbb")
  })

  test("a failing pair is surfaced as AA fail and needs a confirmation naming it", () => {
    const next = settings.editCustomToken(app(), "foreground", "#1A1A1A")
    if ("kind" in next) throw new Error("expected pending state")
    expect(next.pendingPalette?.pair).toBe("foreground on background")
    expect(next.notice).toContain("AA fail")
    expect(settings.confirmPalette(next)).toEqual({
      kind: "patch",
      patch: { "ui.custom_theme": next.custom, "ui.theme": "custom" },
    })

    const confirmed = settings.editCustomToken(app(), "foreground", "#1A1A1A", { confirmed: true })
    if ("kind" in confirmed) throw new Error("expected a state")
    expect(confirmed.pendingPalette).toBe(null)
  })

  test("a passing change applies without a confirmation", () => {
    const next = settings.editCustomToken(app(), "primary", "#12AB34")
    if ("kind" in next) throw new Error("expected a state")
    expect(next.theme).toBe("custom")
    expect(next.pendingPalette).toBe(null)
  })
})

describe("hints, nudges, mouse", () => {
  test("hiding hints is an immediate patch", () => {
    expect(settings.toggleHints(app())).toEqual({ kind: "patch", patch: { "ui.hide_hints": true } })
    expect(settings.toggleHints(app({ hideHints: true }))).toEqual({
      kind: "patch",
      patch: { "ui.hide_hints": false },
    })
  })

  test("nudge intensity shows its threshold and persists", async () => {
    expect(settings.NUDGE_THRESHOLDS).toEqual({ gentle: 5, balanced: 3, intensive: 2 })
    expect(settings.nudgeLine("intensive")).toContain("after 2 misses")
    expect(settings.setNudge(app(), "gentle")).toEqual({
      kind: "patch",
      patch: { "ui.nudge_intensity": "gentle" },
    })
    const setup = await mountPanel(120, 30, app({ nudge: "gentle" }))
    try {
      expect(lines(setup).join("\n")).toContain("offers a focused review after 5 misses")
    } finally {
      await setup.dispose()
    }
  })

  test("mouse defaults to off and toggling writes once", () => {
    expect(settings.initialAppearance(crimson).mouse).toBe(false)
    expect(settings.toggleMouse(app())).toEqual({ kind: "patch", patch: { "ui.mouse": true } })
    expect(settings.MOUSE_COPY).toContain("keyboard reaches every action")
  })
})

describe("environment and layout", () => {
  test("NO_COLOR is reported and the app states colour is never the only signal", async () => {
    const withEnv = settings.noColorState({ NO_COLOR: "1" })
    expect(withEnv.override).toBe(true)
    expect(withEnv.copy).toContain("colour is decoration only")
    const setup = await mountPanel(120, 30, app(), { NO_COLOR: "1" })
    try {
      expect(lines(setup).join("\n")).toContain("NO_COLOR is set")
    } finally {
      await setup.dispose()
    }
  })

  test("reduced motion is honoured", () => {
    expect(settings.reducedMotion({ LOCKEDIN_REDUCED_MOTION: "1" })).toBe(true)
    expect(settings.reducedMotion({})).toBe(false)
  })

  test("80x24 stacks fields without clipping; 200x60 puts the preview beside", async () => {
    for (const [w, h] of [[80, 24], [200, 60]] as const) {
      const setup = await mountPanel(w, h, app({ usernameDraft: "ada" }))
      try {
        const out = lines(setup)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
        const frame = out.join("\n")
        expect(frame).toContain("ada")
      } finally {
        await setup.dispose()
      }
    }
    const wide = await mountPanel(200, 60, app({ usernameDraft: "ada" }))
    try {
      expect(lines(wide).join("\n")).toContain("preview    ada")
    } finally {
      await wide.dispose()
    }
  })

  test("keys come from one table and every control is reachable", async () => {
    expect(settings.intentFor("j")).toBe("down")
    expect(settings.intentFor("return")).toBe("open")
    expect(settings.intentFor("escape")).toBe("back")
    expect(settings.footerHints()).toContain("Enter open")

    const source = readFileSync(join(import.meta.dir, "../../src/ui/settings/appearance.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(/)
    expect(source).not.toContain("src/storage")
  })
})

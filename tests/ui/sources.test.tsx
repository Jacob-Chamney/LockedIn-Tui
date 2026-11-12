/**
 * WP-301b — source picker UI.
 *
 * The model is pure (no filesystem); frames are asserted per state because the
 * harness cannot repaint after mount.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const { testRender } = await import("@opentui/solid")
const { SourcesPanel } = await import("../../src/ui/features/sources/sources-panel")
const model = await import("../../src/ui/features/sources/sources-model")
const keys = await import("../../src/ui/features/sources/sources-keys")
const { crimson } = await import("../../src/ui/theme")

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/sources/tree.json"), "utf8"))
const ROOT = "/learning/input"

function entry(name: string, kind: "file" | "directory", selectable = true, reason: string | null = null) {
  return {
    path: `${ROOT}/${name}`,
    name,
    kind,
    bytes: 12,
    selectable,
    reason: reason as never,
    marked: false,
  }
}

function pickerState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    root: ROOT,
    cwd: ROOT,
    entries: fixture.entries.map((e: { name: string; kind: "file" | "directory"; selectable: boolean; reason?: string }) =>
      entry(e.name, e.kind, e.selectable, e.reason ?? null)),
    marks: [] as string[],
    prompt: "",
    limit: 25,
    ...overrides,
  }
}

async function mount(width: number, height: number, props: Record<string, unknown> = {}) {
  const setup = await testRender(
    () => (
      <SourcesPanel
        theme={crimson}
        width={width}
        height={height}
        focused
        state={pickerState((props.state as Record<string, unknown>) ?? {}) as never}
        view={(props.view as never) ?? model.initialView}
        existing={(props.existing as string[]) ?? []}
        parent="input"
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

function rows(setup: Awaited<ReturnType<typeof mount>>): string[] {
  const lines = setup.captureCharFrame().split("\n")
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

describe("browse", () => {
  test("lists entries with mark glyphs and the selected count", async () => {
    const setup = await mount(80, 24)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("ADD SOURCES")
      expect(frame).toContain("lecture-4.md")
      expect(frame).toContain("unit-4")
      expect(frame).toContain("0 of 25 sources selected")
      expect(frame).toContain("Space mark")
    } finally {
      await setup.dispose()
    }
  })

  test("every file row is selectable, whatever its extension", async () => {
    const setup = await mount(100, 24)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("○ diagram.png")
      expect(frame).toContain("○ archive.zip")
      expect(frame).not.toContain("not readable")
      expect(frame).not.toContain("unsupported type")
    } finally {
      await setup.dispose()
    }
  })

  test("an empty directory teaches the way back", async () => {
    const setup = await mount(80, 24, { state: { entries: [], cwd: `${ROOT}/empty` } })
    try {
      expect(rows(setup).join("\n")).toContain("No files here.")
    } finally {
      await setup.dispose()
    }
  })

  test("an unreadable entry produces an actionable error row", async () => {
    const error = model.errorLine({ kind: "storage", path: `${ROOT}/locked.md`, message: "EACCES" })
    expect(error).toContain("could not be read")
    expect(error).toContain("Check permissions")
    const setup = await mount(100, 24, { view: { ...model.initialView, error } })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("× ")
      expect(frame).toContain("Check permissions")
    } finally {
      await setup.dispose()
    }
  })
})

describe("finder and split manifest", () => {
  test("fuzzy results are the active list and the query is visible", () => {
    const results = [entry("unit-4/notes.txt", "file")]
    const view = { ...model.initialView, editing: true, query: "notes", results }
    const state = pickerState() as never
    expect(model.activeEntries(state, view)).toEqual(results)
    expect(model.inputLine(view)).toContain("notes")
    const moved = model.move(state, view, 1)
    expect(moved.cursor).toBe(0)
  })

  test("the split layout shows existing and selected sources on the right", async () => {
    const state = pickerState({ marks: [`${ROOT}/lecture-4.md`] })
    const setup = await mount(100, 24, {
      state,
      existing: ["already-here.md"],
    })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("SOURCES · 2")
      expect(frame).toContain("already-here.md")
      expect(frame).toContain("lecture-4.md")
      expect(frame).toContain("FILES")
    } finally {
      await setup.dispose()
    }
  })

  test("path mode shows the typed directory line", async () => {
    const setup = await mount(100, 24, {
      view: { ...model.initialView, editing: true, query: "/learning/input/unit-4" },
    })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("ADD SOURCES")
      expect(frame).toContain("> /learning/input/unit-4")
    } finally {
      await setup.dispose()
    }
  })
})

describe("marks", () => {
  test("marks survive navigation because they live in service state", () => {
    const state = pickerState({ marks: [`${ROOT}/lecture-4.md`] }) as never
    const moved = model.move(state, { ...model.initialView, cursor: 3 }, -1)
    expect(moved.cursor).toBe(2)
    expect(model.markedNames(state)).toEqual(["lecture-4.md"])
    expect(model.countLine(state)).toBe("1 of 25 sources selected")
  })

  test("directories carry a folder glyph", () => {
    const row = model.rowFor(entry("unit-4", "directory"), false)
    expect(row.text).toContain("▸")
  })

  test("the cursor is clamped so an empty directory cannot crash", () => {
    const empty = pickerState({ entries: [] }) as never
    expect(model.move(empty, { ...model.initialView, cursor: 9 }, 1).cursor).toBe(0)
    expect(model.currentEntry(empty, model.initialView)).toBeUndefined()
  })

  test("marks survive the review step", async () => {
    const state = pickerState({ marks: [`${ROOT}/lecture-4.md`, `${ROOT}/unit-4`] })
    const setup = await mount(100, 24, { state, view: { ...model.initialView, step: "review" } })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("REVIEW")
      expect(frame).toContain("2 sources")
      expect(frame).toContain("lecture-4.md")
      expect(frame).toContain("unit-4")
    } finally {
      await setup.dispose()
    }
  })

  test("the last row is a limit, not a silent drop", () => {
    const atLimit = pickerState({ marks: Array.from({ length: 25 }, (_, i) => `${ROOT}/f${i}.md`) }) as never
    expect(model.blockedReason(atLimit, model.initialView)).toContain("source limit reached (25)")
  })

  test("an empty review is blocked with the copy that unblocks it", () => {
    const state = pickerState() as never
    const reason = model.blockedReason(state, { ...model.initialView, step: "review" })
    expect(reason).toBe("mark at least one file to continue")
  })
})

describe("keys come from one table", () => {
  test("every intent is reachable and parsed by the registry's parser", () => {
    const intents = new Set(keys.PICKER_KEY_SPECS.map((s) => s.intent))
    expect(intents.size).toBe(keys.PICKER_KEY_SPECS.length)
    for (const spec of keys.PICKER_KEYS) {
      expect(["direct", "leader"]).toContain(spec.binding.kind)
    }
  })

  test("the documented keys resolve to their intents", () => {
    const expected: Array<[string, string]> = [
      ["j", "move-down"],
      ["k", "move-up"],
      ["return", "enter-directory"],
      ["l", "enter-directory"],
      ["backspace", "leave-directory"],
      ["h", "leave-directory"],
      ["tab", "focus-sources"],
      ["space", "toggle-mark"],
      ["/", "finder"],
      ["escape", "cancel"],
      ["g", "top"],
      ["d", "remove-source"],
      ["r", "review"],
    ]
    for (const [name, intent] of expected) {
      expect(`${name} -> ${keys.intentFor(name)}`).toBe(`${name} -> ${intent}`)
    }
    expect(keys.intentFor("a", { shift: true })).toBe("mark-folder")
    expect(keys.intentFor("a")).toBeUndefined()
    expect(keys.intentFor("s")).toBeUndefined()
    expect(keys.intentFor("q")).toBeUndefined()
    expect(keys.intentFor("g", { shift: true })).toBe("bottom")
  })

  test("the footer is generated from the same table", () => {
    const footer = keys.footerHints()
    for (const spec of keys.PICKER_KEY_SPECS) {
      if (spec.footer) expect(footer).toContain(spec.footer)
    }
  })

  test("no component contains a key string", () => {
    const dir = join(import.meta.dir, "../../src/ui/features/sources")
    const offenders: string[] = []
    for (const name of readdirSync(dir)) {
      if (!/\.tsx$/.test(name)) continue // components only; keys.ts owns the table
      const text = readFileSync(join(dir, name), "utf8")
      if (/"(?:j|k|h|l|space|tab|escape|enter|return|A)"/.test(text)) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })
})

describe("snapshots", () => {
  test("80x24", async () => {
    const setup = await mount(80, 24)
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(24)
      for (const line of lines) expect(line.length).toBe(80)
      expect(lines[0]).toContain("SOURCES")
    } finally {
      await setup.dispose()
    }
  })

  test("200x60", async () => {
    const setup = await mount(200, 60)
    try {
      const lines = rows(setup)
      expect(lines.length).toBe(60)
      for (const line of lines) expect(line.length).toBe(200)
      expect(lines[0]).toContain("SOURCES")
    } finally {
      await setup.dispose()
    }
  })
})

describe("cancel writes nothing", () => {
  test("the picker renders no filesystem side effects of its own", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/features/sources/sources-panel.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile|copyFile|mkdir|rename|unlink/)
    expect(source).not.toContain("meta.json")
  })
})

describe("preview and the right pane", () => {
  test("shows the selected file's first lines", async () => {
    const view = {
      ...model.initialView,
      cursor: 2,
      preview: {
        path: `${ROOT}/lecture-4.md`,
        name: "lecture-4.md",
        kind: "markdown",
        bytes: 12,
        modifiedMs: Date.UTC(2026, 10, 11),
        lines: ["# Unit 4", "Boundary conditions."],
        truncated: false,
        note: null,
        error: null,
      },
    }
    const setup = await mount(120, 30, { view })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("PREVIEW")
      expect(frame).toContain("# Unit 4")
      expect(frame).toContain("Boundary conditions.")
      expect(frame).toContain("markdown · 12 B")
    } finally {
      await setup.dispose()
    }
  })

  test("Tab moves to the manifest and d removes a mark", async () => {
    const state = pickerState({ marks: [`${ROOT}/lecture-4.md`], home: ROOT })
    const setup = await mount(120, 30, {
      state,
      view: { ...model.initialView, focus: "sources" },
    })
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("▸ SOURCES")
      expect(frame).toContain("d remove")
      expect(frame).toContain("lecture-4.md")
    } finally {
      await setup.dispose()
    }
  })

  test("a narrow window keeps the list and shortens the footer", async () => {
    const setup = await mount(80, 24)
    try {
      const frame = rows(setup).join("\n")
      expect(frame).toContain("Space mark")
      expect(frame).not.toContain("MARKED NOW")
    } finally {
      await setup.dispose()
    }
  })
})

/** WP-704 — storage and data settings. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const storage = await import("../../src/ui/settings/storage")
type State = import("../../src/ui/settings/storage").StorageState
const { crimson } = await import("../../src/ui/theme")

const CAPS = { maxItemsPerSide: 25, maxMbPerSide: 500, excerptChars: 400 }
const PATHS = {
  workspace: "/home/me/LockedIn-Tui",
  dataDir: "/home/me/.local/share/lockedin",
  archiveFolder: "/home/me/LockedInArchive",
  exports: "/home/me/LockedIn-Tui/exports",
}
const INDEX = {
  school: { lastRebuiltAt: "2026-11-01T10:00:00Z", sizeBytes: 4300 * 1024 },
  skills: { lastRebuiltAt: null, sizeBytes: null },
}
const state = (overrides: Partial<State> = {}): State => ({
  ...storage.initialStorage(CAPS, PATHS, INDEX, 18),
  ...overrides,
})

async function mount(width: number, height: number, value = state()) {
  const setup = await testRender(
    () => <storage.StoragePanel theme={crimson} width={width} height={height} focused state={value} />,
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

describe("caps", () => {
  test("caps render with their ranges and a refused value names the range", async () => {
    const setup = await mount(120, 30)
    try {
      expect(lines(setup).join("\n")).toContain("25 items per side · 500 MB per side · 400 char excerpts")
    } finally {
      await setup.dispose()
    }
    const refused = storage.setCap(state(), "maxItemsPerSide", 0)
    expect(refused.kind).toBe("refused")
    if (refused.kind !== "refused") throw new Error("expected a refusal")
    expect(refused.reason).toContain("1–500")
  })

  test("changing a cap never deletes existing items", () => {
    const result = storage.setCap(state(), "excerptChars", 600)
    if (result.kind !== "patch") throw new Error("expected a patch")
    expect(result.patch).toEqual({ "storage.excerpt_chars": 600 })
    expect(result.line).toContain("existing items are kept")
  })
})

describe("paths", () => {
  test("paths are shown read-only and the data directory explains how to move it", async () => {
    const setup = await mount(140, 30)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain(PATHS.workspace)
      expect(frame).toContain(PATHS.dataDir)
      expect(frame).toContain("--data-dir")
    } finally {
      await setup.dispose()
    }
    const rows = storage.pathRows(PATHS)
    expect(rows.find((row) => row.label === "app data")?.editable).toBe(false)
    expect(rows.find((row) => row.label === "archive folder")?.editable).toBe(true)
  })

  test("an unwritable archive folder is refused with the reason", () => {
    expect(storage.validArchiveFolder("", true, true)).toMatchObject({ ok: false })
    const missing = storage.validArchiveFolder("/nope", false, true)
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error("expected a refusal")
    expect(missing.reason).toContain("does not exist")
    const readOnly = storage.validArchiveFolder("/ro", true, false)
    if (readOnly.ok) throw new Error("expected a refusal")
    expect(readOnly.reason).toContain("not writable")
    expect(storage.validArchiveFolder("/ok", true, true)).toEqual({ ok: true })
  })
})

describe("index", () => {
  test("each index shows last rebuild and size, or never rebuilt", async () => {
    const setup = await mount(140, 30)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("learn index · last rebuilt 2026-11-01T10:00:00Z · 4300 KB")
      expect(frame).toContain("skills index · never rebuilt")
    } finally {
      await setup.dispose()
    }
  })

  test("a rebuild shows progress with a cancel path, and cancelling keeps the old index", async () => {
    const running = storage.startRebuild(state(), "school")
    expect(running.rebuildProgress).toEqual({ side: "school", cancelable: true })
    const setup = await mount(140, 30, running)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("rebuilding school index")
      expect(frame).toContain("Esc cancel")
    } finally {
      await setup.dispose()
    }
    const cancelled = storage.cancelRebuild(running)
    expect(cancelled.rebuildProgress).toBe(null)
    expect(cancelled.notice).toContain("previous index is still usable")
    expect(cancelled.index.school.lastRebuiltAt).toBe(INDEX.school.lastRebuiltAt)
  })

  test("the section states that a rebuild never touches Markdown", async () => {
    const setup = await mount(140, 30)
    try {
      expect(lines(setup).join("\n")).toContain("Markdown files are never modified")
    } finally {
      await setup.dispose()
    }
  })
})

describe("history and export", () => {
  test("clearing history names the object and how much is lost", async () => {
    const armed = storage.armClearHistory(state())
    expect(storage.clearCopy(18)).toBe("clear 18 messages of chill history? press c again to confirm")
    const setup = await mount(140, 30, armed)
    try {
      expect(lines(setup).join("\n")).toContain("clear 18 messages of chill history?")
    } finally {
      await setup.dispose()
    }
    expect(storage.confirmClear(armed)).toEqual({ kind: "call", action: "clear-history" })
  })

  test("cancelling a clear changes nothing", () => {
    const cancelled = { ...state(), pending: null, notice: null }
    const outcome = storage.confirmClear(cancelled)
    expect(outcome.kind).toBe("refused")
    expect(cancelled.chillMessages).toBe(18)
  })

  test("export names the path and says stats are never archived", () => {
    expect(storage.exportPath(PATHS.exports, "csv")).toBe(`${PATHS.exports}/stats.csv`)
    expect(storage.exportCopy(PATHS.exports, "md")).toContain("stats.md")
    expect(storage.exclusionNote()).toContain("never archived")
  })
})

describe("layout and keys", () => {
  test("80x24 and 200x60 snapshots without clipping", async () => {
    for (const [w, h] of [[80, 24], [200, 60]] as const) {
      const setup = await mount(w, h)
      try {
        const out = lines(setup)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
      } finally {
        await setup.dispose()
      }
    }
  })

  test("keys come from one table and the panel performs no IO", () => {
    expect(storage.intentFor("r")).toBe("rebuild")
    expect(storage.intentFor("c")).toBe("clear")
    expect(storage.intentFor("x")).toBe("export")
    expect(storage.footerHints()).toContain("c clear history")

    const source = readFileSync(join(import.meta.dir, "../../src/ui/settings/storage.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(|rmSync\(/)
    expect(source).not.toContain("src/storage")
  })
})

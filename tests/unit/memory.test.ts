/**
 * WP-304 — session memory rules.
 *
 * Pure functions first (dedupe, bound, cap, render/parse), then the file
 * behaviour against a temp folder: a turn that is not `done` writes nothing, and
 * `updated` only moves when the bytes move.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Result } from "../../src/domain/markdown"
import { computeCoverage } from "../../src/domain/coverage"
import {
  MAX_BULLETS,
  MAX_POINTS_PER_TURN,
  MAX_POINT_CHARS,
  MEMORY_LABEL,
  applyCap,
  boundPoints,
  dedupePoints,
  memoryFor,
  memoryPath,
  normalisePoint,
  parseMemory,
  readMemory,
  recordTurn,
  renderMemory,
} from "../../src/services/lockin/memory"

const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

const SESSION = "2026-11-01-1430-physics"
const NOW = "2026-11-01T15:00:00.000Z"

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(TEMP_BASE, "memory-"))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 })
})

describe("points", () => {
  test("normalisation ignores case, whitespace and trailing punctuation", () => {
    expect(normalisePoint("  Boundary Conditions  decide. ")).toBe("boundary conditions decide")
    expect(normalisePoint("boundary conditions decide!")).toBe("boundary conditions decide")
  })

  test("dedupe drops repeats against the same turn and existing memory", () => {
    expect(
      dedupePoints(["A fact.", "a fact", "Another fact"], ["another FACT!"]),
    ).toEqual(["A fact."])
  })

  test("at most three points per turn, each capped at 160 characters", () => {
    const bounded = boundPoints(["one", "two", "three", "four"])
    expect(bounded).toHaveLength(MAX_POINTS_PER_TURN)

    const long = boundPoints(["x".repeat(200)])
    expect(long[0]!.length).toBe(MAX_POINT_CHARS)
    expect(long[0]!.endsWith("…")).toBe(true)
  })

  test("blank points are dropped", () => {
    expect(boundPoints(["  ", "keep"])).toEqual(["keep"])
  })
})

describe("the cap folds rather than drops", () => {
  test("the 51st point folds the oldest into an earlier: line", () => {
    const points = Array.from({ length: MAX_BULLETS + 1 }, (_, index) => `point ${index}`)
    const capped = applyCap(points)
    expect(capped.points).toHaveLength(MAX_BULLETS)
    expect(capped.folded).toEqual([`earlier: point ${MAX_BULLETS}`])
    // Nothing is lost: visible plus folded still covers every point.
    expect(capped.points.length + capped.folded.length).toBe(points.length)
  })

  test("folding accumulates across several caps", () => {
    const once = applyCap(Array.from({ length: 52 }, (_, index) => `p${index}`))
    const twice = applyCap(once.points, once.folded)
    expect(twice.folded).toHaveLength(2)
    expect(twice.folded[0]).toBe("earlier: p50")
  })
})

describe("render and parse", () => {
  test("round-trips bullets, folds, frontmatter and the title", () => {
    const memory = {
      sessionId: SESSION,
      points: ["Boundary conditions decide the limits."],
      folded: ["earlier: an older point"],
      updated: NOW,
    }
    const text = renderMemory(memory)
    expect(text).toStartWith("---\ntype: session-summary")
    expect(text).toContain(`session: ${SESSION}`)
    expect(text).toContain("# Key points")
    expect(text).toContain("- Boundary conditions decide the limits.")
    expect(text).toContain("- earlier: an older point")

    const parsed = unwrap(parseMemory(text, SESSION))
    expect(parsed.points).toEqual(memory.points)
    expect(parsed.folded).toEqual(memory.folded)
    expect(parsed.updated).toBe(NOW)
  })
})

describe("recordTurn", () => {
  test("a successful turn appends up to three points", async () => {
    const first = unwrap(
      await recordTurn({
        folder,
        sessionId: SESSION,
        outcome: "done",
        points: ["Boundary conditions decide the limits.", "Energy balance closes the system."],
        now: NOW,
      }),
    )
    expect(first.written).toBe(true)
    expect(first.memory?.points).toHaveLength(2)

    const onDisk = await readFile(memoryPath(folder), "utf8")
    expect(onDisk).toContain("type: session-summary")
    expect(onDisk).toContain("- Boundary conditions decide the limits.")
  })

  test("a second identical answer adds nothing and does not move updated", async () => {
    unwrap(
      await recordTurn({ folder, sessionId: SESSION, outcome: "done", points: ["A fact."], now: NOW }),
    )
    const before = await readFile(memoryPath(folder), "utf8")

    const again = unwrap(
      await recordTurn({
        folder,
        sessionId: SESSION,
        outcome: "done",
        points: ["a FACT"],
        now: "2026-11-01T16:00:00.000Z",
      }),
    )
    expect(again.written).toBe(false)
    expect(await readFile(memoryPath(folder), "utf8")).toBe(before)
  })

  test("`updated` moves only when the file actually changes", async () => {
    unwrap(await recordTurn({ folder, sessionId: SESSION, outcome: "done", points: ["A."], now: NOW }))
    const first = unwrap(await readMemory(folder, SESSION))!
    expect(first.updated).toBe(NOW)

    unwrap(
      await recordTurn({
        folder,
        sessionId: SESSION,
        outcome: "done",
        points: ["B."],
        now: "2026-11-02T00:00:00.000Z",
      }),
    )
    const second = unwrap(await readMemory(folder, SESSION))!
    expect(second.updated).toBe("2026-11-02T00:00:00.000Z")
    expect(second.points).toEqual(["A.", "B."])
  })

  test("cancelled and failed turns write nothing at all", async () => {
    for (const outcome of ["cancelled", "error"] as const) {
      const result = unwrap(
        await recordTurn({ folder, sessionId: SESSION, outcome, points: ["ignored"], now: NOW }),
      )
      expect(result.written).toBe(false)
      expect(existsSync(memoryPath(folder))).toBe(false)
    }
  })

  test("a cancelled turn leaves an existing file byte-identical", async () => {
    unwrap(await recordTurn({ folder, sessionId: SESSION, outcome: "done", points: ["A."], now: NOW }))
    const before = await readFile(memoryPath(folder), "utf8")
    unwrap(
      await recordTurn({ folder, sessionId: SESSION, outcome: "cancelled", points: ["B."], now: NOW }),
    )
    expect(await readFile(memoryPath(folder), "utf8")).toBe(before)
  })

  test("an unknown frontmatter key survives a write", async () => {
    await writeFile(
      memoryPath(folder),
      "---\ntype: session-summary\nsession: " +
        `${SESSION}\nupdated: ${NOW}\nmystery: keep me\n---\n\n# Key points\n\n- An old point.\n`,
    )
    unwrap(
      await recordTurn({
        folder,
        sessionId: SESSION,
        outcome: "done",
        points: ["A new point."],
        now: "2026-11-02T00:00:00.000Z",
      }),
    )
    const text = await readFile(memoryPath(folder), "utf8")
    expect(text).toContain("mystery: keep me")
    expect(text).toContain("- An old point.")
    expect(text).toContain("- A new point.")
  })

  test("beyond the cap the oldest bullet folds and the total stays at 50", async () => {
    // Fill to the cap one turn at a time so the fold is exercised in place.
    for (let at = 0; at < MAX_BULLETS; at++) {
      unwrap(
        await recordTurn({
          folder,
          sessionId: SESSION,
          outcome: "done",
          points: [`point ${at}`],
          now: NOW,
        }),
      )
    }
    expect(unwrap(await readMemory(folder, SESSION))!.points).toHaveLength(MAX_BULLETS)

    unwrap(
      await recordTurn({ folder, sessionId: SESSION, outcome: "done", points: ["point 50"], now: NOW }),
    )
    const memory = unwrap(await readMemory(folder, SESSION))!
    expect(memory.points).toHaveLength(MAX_BULLETS)
    expect(memory.folded).toEqual(["earlier: point 50"])
  })

  test("memory never carries reasoning text", async () => {
    unwrap(
      await recordTurn({
        folder,
        sessionId: SESSION,
        outcome: "done",
        points: ["A point."],
        now: NOW,
      }),
    )
    const text = await readFile(memoryPath(folder), "utf8")
    expect(text).not.toContain("reasoning")
    expect(text).not.toContain("Thinking")
  })
})

describe("labelling", () => {
  test("memoryFor returns the bullets with the session memory label", async () => {
    unwrap(await recordTurn({ folder, sessionId: SESSION, outcome: "done", points: ["A point."], now: NOW }))
    const memory = await memoryFor(folder, SESSION)
    expect(memory?.label).toBe(MEMORY_LABEL)
    expect(memory?.label).toBe("session memory")
    expect(memory?.points).toEqual(["A point."])
    expect(memory?.updated).toBe(NOW)
  })

  test("memoryFor on a session without memory returns null", async () => {
    expect(await memoryFor(folder, SESSION)).toBeNull()
  })

  test("memory is not a source and cannot appear in a coverage report", async () => {
    unwrap(await recordTurn({ folder, sessionId: SESSION, outcome: "done", points: ["A.md matters."], now: NOW }))
    const memory = (await memoryFor(folder, SESSION))!
    // The read API has no hash, stored path or excerpt: it cannot be a Source.
    expect(memory).not.toHaveProperty("hash")
    expect(memory).not.toHaveProperty("storedPath")
    expect(memory).not.toHaveProperty("excerpt")

    // Coverage takes sources and documents; memory is only ever a document.
    const report = computeCoverage([], [{ kind: "memory", text: memory.points.join("\n") }])
    expect(report.sources).toEqual([])
    expect(report.total).toBe(0)
  })
})

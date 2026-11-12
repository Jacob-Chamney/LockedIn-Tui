import { describe, expect, test } from "bun:test"

import {
  MAX_SESSION_NAME,
  SESSION_FILES,
  SESSION_ID,
  SESSION_SCHEMA,
  addSessionSources,
  createSession,
  formatSessionStamp,
  sessionFiles,
  sessionFolder,
  sessionFromMeta,
  sessionId,
  sessionToMeta,
  withArchived,
  withMemory,
  type LockInSession,
  type SessionError,
} from "../../src/domain/session"
import { makeSource, type Source } from "../../src/domain/source"
import { type Result } from "../../src/domain/markdown"

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, SessionError>): SessionError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

const HASH_A = `sha256:${"a".repeat(64)}`
const HASH_B = `sha256:${"b".repeat(64)}`
const CREATED = "2026-11-01T14:30:00Z"

function source(name: string, hash: string): Source {
  return unwrap(makeSource({ originalPath: `/home/me/input/${name}`, hash }))
}

function session(overrides: Partial<LockInSession> = {}): LockInSession {
  return {
    ...unwrap(
      createSession({
        created: CREATED,
        name: "Physics — Unit 4",
        prompt: "Explain the problem set.",
        sources: [source("lecture-4.md", HASH_A)],
      }),
    ),
    ...overrides,
  }
}

describe("session id", () => {
  test("is YYYY-MM-DD-HHMM-slug, in UTC", () => {
    expect(unwrap(sessionId({ created: CREATED, name: "Physics — Unit 4" }))).toBe(
      "2026-11-01-1430-physics-unit-4",
    )
    expect(unwrap(formatSessionStamp(CREATED))).toBe("2026-11-01-1430")
  })

  test("pads every field, including single-digit minutes", () => {
    expect(unwrap(formatSessionStamp("2026-01-02T03:04:00Z"))).toBe("2026-01-02-0304")
    expect(unwrap(sessionId({ created: "2026-01-02T03:04:00Z", name: "A b" }))).toBe(
      "2026-01-02-0304-a-b",
    )
  })

  test("is deterministic for a fixed clock and name", () => {
    const a = unwrap(sessionId({ created: CREATED, name: "Physics — Unit 4" }))
    const b = unwrap(sessionId({ created: CREATED, name: "Physics — Unit 4" }))
    expect(a).toBe(b)
  })

  test("a Date and an equivalent ISO string give the same id", () => {
    const fromDate = unwrap(sessionId({ created: new Date(CREATED), name: "Physics" }))
    const fromString = unwrap(sessionId({ created: CREATED, name: "Physics" }))
    expect(fromDate).toBe(fromString)
  })

  test("collisions get -2, -3, … and stay stable", () => {
    const base = "2026-11-01-1430-physics-unit-4"
    expect(unwrap(sessionId({ created: CREATED, name: "Physics — Unit 4", taken: [base] }))).toBe(
      `${base}-2`,
    )
    expect(
      unwrap(
        sessionId({ created: CREATED, name: "Physics — Unit 4", taken: [base, `${base}-2`] }),
      ),
    ).toBe(`${base}-3`)
    expect(
      unwrap(
        sessionId({ created: CREATED, name: "Physics — Unit 4", taken: [`${base}-2`, `${base}-3`] }),
      ),
    ).toBe(base)
  })

  test("every generated id matches the documented pattern", () => {
    for (const name of ["Physics — Unit 4", "Résumé / CV", "a", "!!!"]) {
      expect(SESSION_ID.test(unwrap(sessionId({ created: CREATED, name })))).toBe(true)
    }
  })

  test("an unparseable instant is a typed error", () => {
    const error = errorOf(sessionId({ created: "not a date", name: "x" }))
    expect(error.kind).toBe("invalid-session")
    if (error.kind !== "invalid-session") return
    expect(error.field).toBe("created")
  })
})

describe("createSession", () => {
  test("fills the documented paths and defaults", () => {
    const created = session()
    expect(created.id).toBe("2026-11-01-1430-physics-unit-4")
    expect(created.name).toBe("Physics — Unit 4")
    expect(created.created).toBe("2026-11-01T14:30:00.000Z")
    expect(created.prompt).toBe("Explain the problem set.")
    expect(created.sources).toHaveLength(1)
    expect(created.stepsPath).toBe(SESSION_FILES.steps)
    expect(created.chatPath).toBe(SESSION_FILES.chat)
    expect(created.progressPath).toBe(SESSION_FILES.progress)
    expect(created.memoryPath).toBeNull()
    expect(created.archived).toBe(false)
  })

  test("declining steps leaves stepsPath null rather than a missing file", () => {
    const created = unwrap(createSession({ created: CREATED, name: "x", steps: false }))
    expect(created.stepsPath).toBeNull()
    expect(sessionFiles(created)).not.toContain(SESSION_FILES.steps)
  })

  test("a prompt is optional", () => {
    expect(unwrap(createSession({ created: CREATED, name: "x" })).prompt).toBe("")
  })

  test("sources are de-duplicated at creation", () => {
    const created = unwrap(
      createSession({
        created: CREATED,
        name: "x",
        sources: [source("a.md", HASH_A), source("a-copy.md", HASH_A), source("b.md", HASH_B)],
      }),
    )
    expect(created.sources.map((item) => item.hash)).toEqual([HASH_A, HASH_B])
  })

  test("one invalid source fails the whole creation", () => {
    // A caller can hand us a source value that skipped validation.
    const escaped: Source = {
      originalPath: "/home/me/diagram.png",
      storedPath: "../diagram.png",
      name: "diagram.png",
      hash: HASH_A,
      kind: "image",
    }
    const error = errorOf(createSession({ created: CREATED, name: "x", sources: [escaped] }))
    expect(error.kind).toBe("path")
    if (error.kind !== "path") return
    expect(error.reason).toBe("escape")
  })

  test("an empty name is refused", () => {
    const error = errorOf(createSession({ created: CREATED, name: "   " }))
    expect(error.kind).toBe("invalid-session")
    if (error.kind !== "invalid-session") return
    expect(error.field).toBe("name")
  })

  test("an over-long name is refused with the limit", () => {
    const error = errorOf(createSession({ created: CREATED, name: "x".repeat(MAX_SESSION_NAME + 1) }))
    expect(error.kind).toBe("invalid-session")
    expect(error.message).toContain(String(MAX_SESSION_NAME))
  })

  test("a taken id produces a suffixed id without changing the name", () => {
    const created = unwrap(
      createSession({
        created: CREATED,
        name: "Physics — Unit 4",
        taken: ["2026-11-01-1430-physics-unit-4"],
      }),
    )
    expect(created.id).toBe("2026-11-01-1430-physics-unit-4-2")
    expect(created.name).toBe("Physics — Unit 4")
  })

  test("the folder is the id, with no second naming rule", () => {
    const created = session()
    expect(sessionFolder(created)).toBe(created.id)
  })
})

describe("session mutations are pure", () => {
  test("addSessionSources counts additions and leaves duplicates alone", () => {
    const created = session()
    const result = unwrap(
      addSessionSources(created, [source("lecture-4.md", HASH_A), source("extra.pdf", HASH_B)]),
    )
    expect(result.added).toBe(1)
    expect(result.session.sources).toHaveLength(2)
    expect(created.sources).toHaveLength(1)
  })

  test("an invalid source fails the add and changes nothing", () => {
    const created = session()
    const broken: Source = {
      originalPath: "x.md",
      storedPath: "/etc/passwd",
      name: "x.md",
      hash: HASH_B,
      kind: "markdown",
    }
    const error = errorOf(addSessionSources(created, [broken]))
    expect(error.kind).toBe("path")
    expect(created.sources).toHaveLength(1)
  })

  test("archiving is a flag, not a deletion", () => {
    const created = session()
    const archived = withArchived(created, true)
    expect(archived.archived).toBe(true)
    expect(archived.sources).toBe(created.sources)
    expect(created.archived).toBe(false)
  })

  test("memory starts absent and is recorded once summarised", () => {
    const created = session()
    expect(created.memoryPath).toBeNull()
    const withNote = withMemory(created)
    expect(withNote.memoryPath).toBe(SESSION_FILES.memory)
    expect(sessionFiles(withNote)).toContain(SESSION_FILES.memory)
  })
})

describe("meta.json round-trip (plain object, no methods)", () => {
  test("serializes the documented snake_case shape", () => {
    const meta = sessionToMeta(session())
    expect(meta.schema).toBe(SESSION_SCHEMA)
    expect(meta.steps).toBe(true)
    expect(meta.sources[0]).toEqual({
      original_path: "/home/me/input/lecture-4.md",
      stored_path: "sources/aaaaaaaa-lecture-4.md",
      name: "lecture-4.md",
      hash: HASH_A,
      kind: "markdown",
    })
    // Nothing on disk may be a function.
    expect(JSON.stringify(meta)).not.toContain("function")
    expect(Object.values(meta).some((value) => typeof value === "function")).toBe(false)
  })

  test("survives JSON.stringify -> parse -> entity unchanged", () => {
    const original = session({ memoryPath: SESSION_FILES.memory, archived: true })
    const wire = JSON.parse(JSON.stringify(sessionToMeta(original))) as unknown
    // Memory presence is a filesystem fact, so storage tells us about it.
    const back = unwrap(sessionFromMeta(wire, { memory: true }))
    expect(back).toEqual(original)
  })

  test("without the memory hint the path stays absent", () => {
    const wire = JSON.parse(JSON.stringify(sessionToMeta(session()))) as unknown
    expect(unwrap(sessionFromMeta(wire)).memoryPath).toBeNull()
  })

  test("steps: false round-trips as a null stepsPath", () => {
    const original = unwrap(createSession({ created: CREATED, name: "x", steps: false }))
    const back = unwrap(sessionFromMeta(JSON.parse(JSON.stringify(sessionToMeta(original)))))
    expect(back.stepsPath).toBeNull()
  })

  test("an empty source list round-trips", () => {
    const original = unwrap(createSession({ created: CREATED, name: "Prompt only" }))
    const back = unwrap(sessionFromMeta(sessionToMeta(original)))
    expect(back.sources).toEqual([])
    expect(back).toEqual(original)
  })

  test("instruction provenance round-trips, and old metadata without it reads as null", () => {
    const original = session({
      instructions: {
        ...source("ComplexNumbers.pdf", HASH_B),
        kind: "pdf",
        extractedAt: "2026-11-07T18:00:00.000Z",
        characters: 2848,
        pages: 2,
      },
    })
    const back = unwrap(sessionFromMeta(JSON.parse(JSON.stringify(sessionToMeta(original)))))
    expect(back.instructions).toEqual(original.instructions)

    const old = sessionToMeta(session()) as unknown as Record<string, unknown>
    delete old.instructions_source
    expect(unwrap(sessionFromMeta(old)).instructions).toBeNull()
  })

  test("unknown keys in meta are ignored, not fatal", () => {
    const wire = { ...sessionToMeta(session()), future_field: "keep me" }
    expect(unwrap(sessionFromMeta(wire)).id).toBe(session().id)
  })
})

describe("meta.json validation", () => {
  test("a non-object is refused", () => {
    expect(errorOf(sessionFromMeta("nope")).kind).toBe("invalid-session")
    expect(errorOf(sessionFromMeta(null)).kind).toBe("invalid-session")
    expect(errorOf(sessionFromMeta([])).kind).toBe("invalid-session")
  })

  test("an unknown schema is refused by number", () => {
    const error = errorOf(sessionFromMeta({ ...sessionToMeta(session()), schema: 2 }))
    expect(error.kind).toBe("invalid-session")
    if (error.kind !== "invalid-session") return
    expect(error.field).toBe("schema")
    expect(error.message).toContain("schema 2")
  })

  test("a malformed id is refused", () => {
    for (const id of ["nope", "2026-11-01-x", "", null]) {
      const error = errorOf(sessionFromMeta({ ...sessionToMeta(session()), id }))
      expect(error.kind).toBe("invalid-session")
    }
  })

  test("a missing name, created or sources array is refused", () => {
    const base = sessionToMeta(session())
    expect(errorOf(sessionFromMeta({ ...base, name: "  " })).kind).toBe("invalid-session")
    expect(errorOf(sessionFromMeta({ ...base, created: "soon" })).kind).toBe("invalid-session")
    expect(errorOf(sessionFromMeta({ ...base, sources: "no" })).kind).toBe("invalid-session")
  })

  test("a source with an escaping stored path fails the load", () => {
    const base = sessionToMeta(session())
    const sources = [{ ...base.sources[0]!, stored_path: "../escape.md" }]
    const error = errorOf(sessionFromMeta({ ...base, sources }))
    expect(error.kind).toBe("path")
  })

  test("a source missing a field is refused, never dropped", () => {
    const base = sessionToMeta(session())
    const error = errorOf(sessionFromMeta({ ...base, sources: [{ name: "a.md" }] }))
    expect(error.kind).toBe("invalid-session")
    if (error.kind !== "invalid-session") return
    expect(error.field).toBe("sources[0]")
  })

  test("a non-object source entry is refused", () => {
    const base = sessionToMeta(session())
    const error = errorOf(sessionFromMeta({ ...base, sources: ["a.md"] }))
    expect(error.kind).toBe("invalid-session")
  })
})

/** WP-805 — activity log viewer: filters, decisions, no content. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { testRender } = await import("@opentui/solid")
const activity = await import("../../src/ui/work/activity")
type View = import("../../src/ui/work/activity").ActivityView
type Record_ = import("../../src/services/work/activity").ActivityRecord
const { crimson } = await import("../../src/ui/theme")

const RECORDS: Record_[] = [
  {
    kind: "write-decision",
    project: "my-app",
    path: "src/a.ts",
    decision: "approve",
    hunks: [0],
    at: "2026-11-01T10:00:00Z",
  },
  {
    kind: "command-decision",
    project: "my-app",
    argv: ["ls", "-la"],
    cwd: ".",
    decision: "deny",
    exitCode: null,
    durationMs: 0,
    timedOut: false,
    at: "2026-11-01T11:00:00Z",
  },
  {
    kind: "swarm",
    project: "other",
    run: "run-1",
    event: "finished",
    at: "2026-11-01T12:00:00Z",
  },
] as Record_[]

async function mount(width: number, height: number, view: View = activity.initialActivity, records = RECORDS, skipped = 0) {
  const setup = await testRender(
    () => (
      <activity.ActivityPane
        theme={crimson}
        width={width}
        height={height}
        focused
        view={view}
        records={records}
        skipped={skipped}
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

describe("rows", () => {
  test("renders time, kind, project and a one-line summary for all three kinds", async () => {
    const setup = await mount(200, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("2026-11-01T10:00:00Z  write-decision  my-app  src/a.ts · approved ✓")
      expect(frame).toContain("command-decision  my-app  ls -la · denied ×")
      expect(frame).toContain("swarm  other  run-1 · finished")
    } finally {
      await setup.dispose()
    }
  })

  test("newest first", () => {
    expect(activity.sortRecords(RECORDS).map((r) => r.at)).toEqual([
      "2026-11-01T12:00:00Z",
      "2026-11-01T11:00:00Z",
      "2026-11-01T10:00:00Z",
    ])
  })

  test("a decision is a word and a glyph, never colour alone", () => {
    expect(activity.decisionLabel("approve")).toBe("approved ✓")
    expect(activity.decisionLabel("reject")).toBe("rejected ×")
    expect(activity.decisionLabel("deny")).toBe("denied ×")
  })
})

describe("filters", () => {
  test("k cycles the kind and the header names the filter and count", async () => {
    const once = activity.cycleKind(activity.initialActivity)
    expect(once.filter.kind).toBe("write-decision")
    const twice = activity.cycleKind(once)
    expect(twice.filter.kind).toBe("command-decision")

    const setup = await mount(120, 24, once)
    try {
      const header = lines(setup).join("\n")
      expect(header).toContain("write-decision")
      expect(header).toContain("1 shown")
    } finally {
      await setup.dispose()
    }
    // cycling passes through every kind and wraps back to "all kinds"
    const third = activity.cycleKind(twice)
    expect(third.filter.kind).toBe("swarm")
    expect(activity.headerLine(third, 1, 0)).toContain("swarm")
    expect(activity.cycleKind(third).filter.kind).toBe(null)
  })

  test("p restricts to the current project and c clears", () => {
    const project = activity.filterProject(activity.initialActivity, "my-app")
    expect(activity.visibleRecords(RECORDS, project.filter)).toHaveLength(2)
    expect(project.filter.project).toBe("my-app")

    const cleared = activity.clearFilters(project)
    expect(cleared.filter).toEqual({ kind: null, project: null })
    expect(activity.visibleRecords(RECORDS, cleared.filter)).toHaveLength(3)

    // pressing p again on the same project toggles it off
    expect(activity.filterProject(project, "my-app").filter.project).toBe(null)
  })

  test("the keys match the documented set", () => {
    expect(activity.intentFor("k")).toBe("kind")
    expect(activity.intentFor("p")).toBe("project")
    expect(activity.intentFor("c")).toBe("clear")
    expect(activity.intentFor("j")).toBe("down")
    expect(activity.footerHints()).toContain("c clear")
  })
})

describe("no content", () => {
  test("a row renders no prompt, diff or command output", async () => {
    const setup = await mount(200, 24)
    try {
      const frame = lines(setup).join("\n")
      for (const leak of ["+4 −1", "@@ -", "diff --git", "body:", "prompt"]) {
        expect(frame).not.toContain(leak)
      }
    } finally {
      await setup.dispose()
    }
  })

  test("the pane would not render content fields even if a record carried them", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/work/activity.tsx"), "utf8")
    for (const field of ["content", "prompt", "body", "output", "diff"]) {
      expect(source).not.toMatch(new RegExp(`record\\.${field}\\b`))
    }
    const html = activity.rowText({
      kind: "write-decision",
      project: "p",
      path: "src/a.ts",
      decision: "approve",
      hunks: [0],
      at: "t",
      // deliberately smuggle content in; the renderer must ignore it
      content: "SECRET BODY",
    } as never)
    expect(html).not.toContain("SECRET BODY")
  })

  test("nothing writes, prunes or rotates the log", () => {
    const source = readFileSync(join(import.meta.dir, "../../src/ui/work/activity.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile\(|appendFile\(|rename\(|unlink\(|rmSync\(|truncate/)
    expect(source).not.toContain("createActivity")
  })
})

describe("states and layout", () => {
  test("empty and filtered-empty copies", async () => {
    const empty = await mount(80, 24, activity.initialActivity, [])
    try {
      const out = lines(empty)
      expect(out.join("\n")).toContain("no activity yet")
      for (const line of out) expect(line.length).toBe(80)
    } finally {
      await empty.dispose()
    }

    const filtered = await mount(
      100,
      24,
      { filter: { kind: "swarm", project: "my-app" }, cursor: 0, notice: null },
    )
    try {
      expect(lines(filtered).join("\n")).toContain("no swarm records for this project · c to clear")
    } finally {
      await filtered.dispose()
    }
  })

  test("a corrupt line is counted in the header and the rest still list", async () => {
    const setup = await mount(120, 24, activity.initialActivity, RECORDS, 2)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("2 skipped")
      expect(frame).toContain("write-decision")
      expect(frame).toContain("swarm")
    } finally {
      await setup.dispose()
    }
  })

  test("Enter opens a write decision or says the target is gone", () => {
    expect(activity.openSelected(RECORDS[0])).toEqual({ kind: "open", path: "src/a.ts" })
    expect(activity.openSelected(RECORDS[2])).toEqual({
      kind: "refused",
      reason: "swarm records have nothing to open",
    })
    expect(activity.openSelected(undefined).kind).toBe("refused")
    expect(activity.missingTargetCopy("src/gone.ts")).toContain("no longer exists")
  })

  test("80x24 truncates summaries with an ellipsis and keeps the header on one line", async () => {
    const long = {
      ...RECORDS[0],
      path: `src/${"deeply-nested-".repeat(6)}file.ts`,
    } as Record_
    const setup = await mount(80, 24, activity.initialActivity, [long])
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
      expect(out.join("\n")).toContain("ACTIVITY ·")
      expect(out.join("\n")).toContain("…")
    } finally {
      await setup.dispose()
    }
  })

  test("200x60 renders without clipping", async () => {
    const setup = await mount(200, 60)
    try {
      const out = lines(setup)
      expect(out.length).toBe(60)
      for (const line of out) expect(line.length).toBe(200)
    } finally {
      await setup.dispose()
    }
  })
})

/** WP-707 — swarm plan view, lanes and board. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const swarm = await import("../../src/ui/work/swarm")
const board = await import("../../src/ui/work/board")
type Board = import("../../src/services/work/swarm").SwarmBoard
const { crimson } = await import("../../src/ui/theme")

const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `task ${id}`,
  agentId: "a1",
  assignment: "do the thing",
  status,
  ...extra,
})

const BOARD: Board = {
  runId: "run-1",
  projectId: "p1",
  objective: "add pagination",
  status: "running",
  parallel: 2,
  startedAt: "2026-11-01T10:00:00Z",
  reportPath: null,
  live: true,
  tasks: [
    task("task-1", "done"),
    task("task-2", "running"),
    task("task-3", "failed", { error: "boom" }),
    task("task-4", "cancelled"),
    task("task-5", "pending"),
  ],
} as Board

async function mountPlan(width: number, height: number, props: Record<string, unknown> = {}) {
  const rows = swarm.planRows(
    [{ title: "parse args", assignment: "read the CLI" }, { title: "add page", agentId: "a2", assignment: "edit the query" }],
    (id) => (id === "a2" ? "Builder" : id),
    "Reviewer",
  )
  const setup = await testRender(
    () => (
      <swarm.SwarmPlanPane
        theme={crimson}
        width={width}
        height={height}
        focused
        objective="add pagination"
        parallel={(props.parallel as number) ?? 2}
        rows={rows}
        cursor={0}
      />
    ),
    { width, height },
  )
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

async function mountBoard(width: number, height: number, value: Board = BOARD, notice?: string) {
  const setup = await testRender(
    () => (
      <board.SwarmBoardPane
        theme={crimson}
        width={width}
        height={height}
        focused
        board={value}
        agents={{ a1: "Reviewer" }}
        cursor={1}
        notice={notice ?? null}
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

describe("plan", () => {
  test("lists tasks with agent and assignment before anything runs", async () => {
    const setup = await mountPlan(140, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("parse args  Reviewer  read the CLI  read-only")
      expect(frame).toContain("add page  Builder  edit the query  read-only")
      expect(frame).toContain("SWARM PLAN · parallel · 2 of 4")
      expect(frame).toContain("every worker is read-only")
    } finally {
      await setup.dispose()
    }
  })

  test("Esc on the plan creates no run: the view has no start side effect", () => {
    // The plan pane is pure; only `intentFor` names the start action, and
    // `Esc` maps to close, which the shell handles without calling the service.
    expect(swarm.intentFor("escape")).toBe("close")
    expect(swarm.startRefusal(2)).toBe(null)
    expect(swarm.modeLabel(1)).toBe("sequential")
  })

  test("a request above the cap is refused by name and creates nothing", async () => {
    const refusal = swarm.startRefusal(5)
    expect(refusal).toContain("parallel 5 exceeds the cap of 4")
    const setup = await mountPlan(140, 24, { parallel: 5 })
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("exceeds the cap of 4")
      expect(frame).toContain("choose 1–4")
    } finally {
      await setup.dispose()
    }
  })

  test("the empty state offers a next action", async () => {
    const setup = await testRender(
      () => (
        <swarm.SwarmPlanPane theme={crimson} width={80} height={24} focused objective="" parallel={1} rows={[]} cursor={0} />
      ),
      { width: 80, height: 24 },
    )
    try {
      await setup.flush()
      await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
      const out = lines(setup)
      expect(out.join("\n")).toContain("no swarms yet")
      expect(out.join("\n")).toContain("press n")
      for (const line of out) expect(line.length).toBe(80)
    } finally {
      await setup.dispose()
    }
  })
})

describe("lanes", () => {
  test("renders all five statuses with a glyph and a word", async () => {
    const setup = await mountBoard(200, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("✓ done")
      expect(frame).toContain("▸ running")
      expect(frame).toContain("× failed")
      expect(frame).toContain("— cancelled")
      expect(frame).toContain("… pending")
      expect(frame).toContain("read-only")
    } finally {
      await setup.dispose()
    }
    expect(board.statusLabel("pending")).toBe("… pending")
    expect(board.statusLabel("running")).toBe("▸ running")
  })

  test("a lane never regresses from done to running", () => {
    const done = task("t", "done") as never
    expect(board.applyUpdate(done, { status: "running" }).status).toBe("done")
    expect(board.applyUpdate(done, { status: "failed" }).status).toBe("failed")
    const next = board.applyBatch(BOARD, [{ id: "task-1", status: "running" }])
    expect(next.tasks[0]!.status).toBe("done")
  })

  test("batched updates apply in one pass", () => {
    const next = board.applyBatch(BOARD, [
      { id: "task-2", status: "done" },
      { id: "task-5", status: "running" },
    ])
    expect(next.tasks[1]!.status).toBe("done")
    expect(next.tasks[4]!.status).toBe("running")
  })
})

describe("cancellation", () => {
  test("c asks when output exists and declining changes nothing", () => {
    const withOutput = { ...BOARD, tasks: [{ ...task("task-1", "running"), summary: "3 lines" }] } as Board
    const asked = board.cancelTask(withOutput, "task-1")
    expect(asked.kind).toBe("confirm")
    if (asked.kind !== "confirm") throw new Error("expected a confirmation")
    expect(asked.reason).toBe(board.CANCEL_COPY)
    expect(withOutput.tasks[0]!.status).toBe("running")
    expect(board.cancelTask(withOutput, "task-1", true)).toEqual({ kind: "cancel", taskId: "task-1" })
  })

  test("a terminal task cannot be cancelled", () => {
    const refused = board.cancelTask(BOARD, "task-1")
    expect(refused.kind).toBe("refused")
    if (refused.kind !== "refused") throw new Error("expected a refusal")
    expect(refused.reason).toContain("already done")
  })

  test("cancelling the run marks the remainder and reports the count", () => {
    const { board: cancelled, stopped } = board.cancelRun(BOARD)
    expect(stopped).toBe(2) // running + pending
    expect(cancelled.tasks.map((t) => t.status)).toEqual(["done", "cancelled", "failed", "cancelled", "cancelled"])
    expect(cancelled.status).toBe("cancelled")
    expect(board.cancelRunCopy(stopped)).toBe("cancelled the run · 2 tasks stopped")
  })
})

describe("retry and report", () => {
  test("R creates a new single-agent read-only run and leaves the original alone", () => {
    const request = board.retryRequest(BOARD, "task-3")
    expect(request).toEqual({
      kind: "retry",
      runId: "run-1",
      taskId: "task-3",
      parallel: 1,
      parallelLabel: "one agent",
      readOnly: true,
    })
    expect(BOARD.tasks[2]!.status).toBe("failed")
    expect(BOARD.runId).toBe("run-1")
    const refused = board.retryRequest(BOARD, "task-1")
    expect(refused.kind).toBe("refused")
  })

  test("a retry run is labelled beside the original", () => {
    const retried = { ...BOARD, runId: "run-2", retryOf: { runId: "run-1", taskId: "task-3" } } as Board
    expect(board.retryBadge(retried)).toBe("retry of run-1 · one agent · read-only")
    expect(board.retryBadge(BOARD)).toBe(null)
  })

  test("o opens a report whose header shows the run status", () => {
    expect(board.reportHeader(BOARD)).toBe("add pagination · running · 5 tasks")
    const cancelled = { ...BOARD, status: "cancelled" } as Board
    expect(board.reportHeader(cancelled)).toContain("cancelled")
    expect(board.intentFor("o")).toBe("report")
  })
})

describe("layout and limits", () => {
  test("80x24 keeps one lane per row; 200x60 puts lanes in columns", async () => {
    for (const [w, h, cols] of [[80, 24, false], [200, 60, true]] as const) {
      const setup = await mountBoard(w, h)
      try {
        const out = lines(setup)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
        expect(out.join("\n")).toContain("read-only")
      } finally {
        await setup.dispose()
      }
      expect(board.layoutFor(w) === "columns").toBe(cols)
    }
  })

  test("no control grants writes or commands", () => {
    for (const name of ["swarm.tsx", "board.tsx"]) {
      const source = readFileSync(join(import.meta.dir, "../../src/ui/work", name), "utf8")
      expect(source).toContain("read-only")
      // No control wires a capability on: the disclaimer text is the only
      // place the words appear, so assert on the *values* a control would set.
      expect(source).not.toMatch(/allowWrite:\s*true|allowCommand:\s*true|allow_command\s*=\s*true/)
      expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(/)
      expect(source).not.toContain("createSwarmService")
    }
  })

  test("keys come from one table", () => {
    expect(swarm.intentFor("return")).toBe("start")
    expect(board.intentFor("c")).toBe("cancel")
    expect(board.intentFor("r", { shift: true })).toBe("retry")
    expect(board.footerHints()).toContain("R retry")
    expect(board.CANCEL_COPY).toContain("already produced output")
  })
})

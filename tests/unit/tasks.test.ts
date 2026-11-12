/** WP-205 — the task registry: one record per operation, one terminal event. */
import { describe, expect, test } from "bun:test"

import { TaskRegistry, isTerminal } from "../../src/domain/tasks"

function registry() {
  let now = 1_700_000_000_000
  const cancelled: string[] = []
  const reg = new TaskRegistry({ clock: () => now, cancelPort: (id) => cancelled.push(id) })
  return { reg, cancelled, tick: (ms: number) => (now += ms) }
}

describe("registration", () => {
  test("a long operation registers one running task", () => {
    const { reg } = registry()
    const task = reg.start({ id: "req-1", kind: "chat", label: "answering" })
    expect(task.status).toBe("running")
    expect(reg.runningCount()).toBe(1)
    expect(reg.list()).toHaveLength(1)
  })

  test("starting the same id twice returns the same record, not a duplicate", () => {
    const { reg } = registry()
    reg.start({ id: "req-1", kind: "chat", label: "answering" })
    reg.start({ id: "req-1", kind: "chat", label: "answering" })
    expect(reg.list()).toHaveLength(1)
  })
})

describe("exactly one terminal event", () => {
  test("a second terminal event on the same task is ignored", () => {
    const { reg } = registry()
    reg.start({ id: "req-1", kind: "chat", label: "answering" })
    reg.finish("req-1", { type: "done", usage: { input: 10, output: 4, total: 14 } })
    const again = reg.finish("req-1", { type: "failed", error: "late error" })
    expect(again?.status).toBe("done")
    expect(again?.error).toBeUndefined()
    expect(again?.usage).toEqual({ input: 10, output: 4, total: 14 })
  })

  test("finished tasks freeze their finish time", () => {
    const { reg, tick } = registry()
    reg.start({ id: "a", kind: "chat", label: "a" })
    tick(2000)
    const task = reg.finish("a", { type: "done" })!
    expect(Date.parse(task.finishedAt!)).toBeGreaterThan(Date.parse(task.startedAt))
  })

  test("a failure keeps the copy the chat bubble shows", () => {
    const { reg } = registry()
    reg.start({ id: "a", kind: "chat", label: "a" })
    const task = reg.finish("a", { type: "failed", error: "Provider rejected the key. Relink it in Settings." })!
    expect(task.status).toBe("failed")
    expect(task.error).toBe("Provider rejected the key. Relink it in Settings.")
  })
})

describe("cancellation is one path", () => {
  test("cancel asks the owner and never marks the task itself", () => {
    const { reg, cancelled } = registry()
    reg.start({ id: "req-1", kind: "chat", label: "answering" })
    expect(reg.cancel("req-1")).toBe("asked")
    expect(cancelled).toEqual(["req-1"])
    // still running until the owner's terminal event arrives
    expect(reg.get("req-1")?.status).toBe("running")

    reg.finish("req-1", { type: "cancelled" })
    expect(reg.get("req-1")?.status).toBe("cancelled")
  })

  test("chat Esc and task-centre c take the same path and the same final state", () => {
    const a = registry()
    const b = registry()
    a.reg.start({ id: "req-1", kind: "chat", label: "answering" })
    b.reg.start({ id: "req-1", kind: "chat", label: "answering" })

    a.reg.cancel("req-1")
    a.reg.finish("req-1", { type: "cancelled" })
    b.reg.cancel("req-1")
    b.reg.finish("req-1", { type: "cancelled" })

    expect(a.reg.get("req-1")).toEqual(b.reg.get("req-1"))
    expect(a.cancelled).toEqual(b.cancelled)
  })

  test("a task that already produced output asks once before stopping", () => {
    const { reg, cancelled } = registry()
    reg.start({ id: "req-1", kind: "chat", label: "answering" })
    reg.noteOutput("req-1")
    expect(reg.cancel("req-1")).toBe("needs-confirmation")
    expect(cancelled).toEqual([])
    expect(reg.cancel("req-1", { confirmed: true })).toBe("asked")
    expect(cancelled).toEqual(["req-1"])
  })

  test("cancelling a finished task does nothing and is reported once", () => {
    const { reg, cancelled } = registry()
    reg.start({ id: "a", kind: "chat", label: "a" })
    reg.finish("a", { type: "done" })
    expect(reg.cancel("a")).toBe("already-finished")
    expect(cancelled).toEqual([])
  })

  test("a non-cancellable task is never stopped from the centre", () => {
    const { reg, cancelled } = registry()
    reg.start({ id: "a", kind: "generation", label: "a", cancellable: false })
    expect(reg.cancel("a")).toBe("needs-confirmation")
    expect(cancelled).toEqual([])
  })
})

describe("ordering and lifetime", () => {
  test("running first, then the newest finished", () => {
    const { reg, tick } = registry()
    reg.start({ id: "old", kind: "chat", label: "old" })
    tick(10)
    reg.start({ id: "new", kind: "chat", label: "new" })
    tick(10)
    reg.finish("old", { type: "done" })
    tick(10)
    reg.finish("new", { type: "cancelled" })
    expect(reg.list().map((t) => t.id)).toEqual(["new", "old"])

    reg.start({ id: "running", kind: "chat", label: "running" })
    expect(reg.list()[0]?.id).toBe("running")
  })

  test("in-memory only: a fresh registry starts empty", () => {
    const first = new TaskRegistry()
    first.start({ id: "a", kind: "chat", label: "a" })
    expect(new TaskRegistry().list()).toEqual([])
    expect(isTerminal("running")).toBe(false)
  })
})

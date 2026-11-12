/**
 * WP-404 — chats and progress on real goal folders.
 *
 * Goals are created through WP-401's save path, so `meta.json` is the shape the
 * manager and the chat both read.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Result } from "../../src/domain/markdown";
import { createWorkspace, type Workspace } from "../../src/storage/workspace";
import { saveGoal, validateInput, type StageDraft } from "../../src/services/skills/create";
import { appendTurn, deleteChat, listChats, openChat, readChat, type ChatError } from "../../src/services/skills/chats";
import { applyTransition, listGoals, readMeta, type GoalEvent, type ProgressError } from "../../src/services/skills/progress";
const TEMP_BASE = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir()
const CREATED = "2026-11-01T14:30:00.000Z"
const STAGES: StageDraft[] = [
  { title: "Registers", milestone: "explain a stack frame" },
  { title: "Control flow", milestone: "trace a loop" },
  { title: "Conventions", milestone: "read a prologue" },
]

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

function errorOf<T>(result: Result<T, ChatError | ProgressError>): ChatError | ProgressError {
  if (result.ok) throw new Error("expected an error, got a value")
  return result.error
}

let base: string
let workspace: Workspace
let goalId: string
let goalFolder: string

async function makeGoal(statement: string, takenIds: string[] = [], created = CREATED) {
  const saved = unwrap(
    await saveGoal({
      workspace,
      input: unwrap(validateInput({ statement, level: "beginner", timeBudget: "6 weeks" })),
      stages: STAGES,
      created,
      takenIds,
    }),
  )
  return saved
}

beforeEach(async () => {
  base = await mkdtemp(join(TEMP_BASE, "skills-chats-"))
  workspace = unwrap(await createWorkspace(join(base, "workspace")))
  const saved = await makeGoal("read disassembly")
  goalId = saved.goal.id
  goalFolder = saved.folder
})

afterEach(async () => {
  await removeTemp(base)
})

describe("chats", () => {
  test("openChat with no id creates chat-1, registers it once and returns the path", async () => {
    const events: GoalEvent[] = []
    const chat = unwrap(await openChat({ workspace, goalId, emit: (event) => events.push(event) }))

    expect(chat.id).toBe("chat-1")
    expect(chat.path).toBe(join(goalFolder, "chats", "chat-1.jsonl"))
    expect(existsSync(chat.path)).toBe(true)
    expect(unwrap(await listChats(workspace, goalId))).toEqual(["chat-1"])
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("goal.updated")
  })

  test("a second openChat creates chat-2, and reopening chat-1 writes nothing", async () => {
    unwrap(await openChat({ workspace, goalId }))
    const second = unwrap(await openChat({ workspace, goalId }))
    expect(second.id).toBe("chat-2")

    const before = await readFile(join(goalFolder, "meta.json"), "utf8")
    const reopened = unwrap(await openChat({ workspace, goalId, chatId: "chat-1" }))
    expect(reopened.id).toBe("chat-1")
    expect(await readFile(join(goalFolder, "meta.json"), "utf8")).toBe(before)
    expect((await readdir(join(goalFolder, "chats"))).sort()).toEqual([
      "chat-1.jsonl",
      "chat-2.jsonl",
    ])
  })

  test("deleting the last chat is refused and the file stays", async () => {
    const chat = unwrap(await openChat({ workspace, goalId }))
    const error = errorOf(
      await deleteChat({ workspace, goalId, chatId: chat.id, confirmed: true }),
    )
    expect(error.kind).toBe("blocked")
    if (error.kind !== "blocked") return
    expect(error.message).toBe("a goal keeps at least one chat")
    expect(existsSync(chat.path)).toBe(true)
  })

  test("deleting chat-1 of two removes the file and updates the list", async () => {
    unwrap(await openChat({ workspace, goalId }))
    unwrap(await openChat({ workspace, goalId }))

    const outcome = unwrap(await deleteChat({ workspace, goalId, chatId: "chat-1", confirmed: true }))
    expect(outcome.deleted).toBe(true)
    expect(outcome.remaining).toEqual(["chat-2"])
    expect(existsSync(join(goalFolder, "chats", "chat-1.jsonl"))).toBe(false)
    expect(unwrap(await listChats(workspace, goalId))).toEqual(["chat-2"])
  })

  test("a cancelled turn leaves the chat file byte-identical", async () => {
    const chat = unwrap(await openChat({ workspace, goalId }))
    unwrap(
      await appendTurn({
        workspace,
        goalId,
        chatId: chat.id,
        outcome: "done",
        record: { role: "user", content: "what is a register?", at: CREATED },
      }),
    )
    const before = await readFile(chat.path, "utf8")

    const cancelled = unwrap(
      await appendTurn({
        workspace,
        goalId,
        chatId: chat.id,
        outcome: "cancelled",
        record: { role: "assistant", content: "partial", at: CREATED },
      }),
    )
    expect(cancelled.written).toBe(false)
    expect(await readFile(chat.path, "utf8")).toBe(before)

    unwrap(
      await appendTurn({
        workspace,
        goalId,
        chatId: chat.id,
        outcome: "error",
        record: { role: "assistant", content: "failed", at: CREATED },
      }),
    )
    expect(await readFile(chat.path, "utf8")).toBe(before)
  })

  test("a completed turn appends one JSONL record", async () => {
    const chat = unwrap(await openChat({ workspace, goalId }))
    unwrap(
      await appendTurn({
        workspace,
        goalId,
        chatId: chat.id,
        outcome: "done",
        record: { role: "assistant", content: "a register is working state", at: CREATED },
      }),
    )
    const records = unwrap(await readChat({ workspace, goalId, chatId: chat.id }))
    expect(records).toHaveLength(1)
    expect(records[0]?.content).toContain("working state")
  })
})

describe("stage progress", () => {
  test("marking stage 1 done promotes stage 2 and emits once", async () => {
    const events: GoalEvent[] = []
    const outcome = unwrap(
      await applyTransition({
        workspace,
        goalId,
        stageId: "stage-1",
        action: "done",
        emit: (event) => events.push(event),
      }),
    )
    expect(outcome.stages.map((stage) => stage.status)).toEqual(["done", "active", "pending"])
    expect(outcome.progress).toEqual({ "stage-1": true, "stage-2": false, "stage-3": false })
    expect(events).toHaveLength(1)

    const onDisk = unwrap(await readMeta(goalFolder))
    expect((onDisk.meta.progress as Record<string, boolean>)["stage-1"]).toBe(true)
  })

  test("completing the last stage leaves zero active and marks the goal complete", async () => {
    for (const id of ["stage-1", "stage-2"]) {
      unwrap(await applyTransition({ workspace, goalId, stageId: id, action: "done" }))
    }
    const final = unwrap(
      await applyTransition({ workspace, goalId, stageId: "stage-3", action: "done" }),
    )
    expect(final.complete).toBe(true)
    expect(final.activeStageId).toBeNull()
    expect(final.stages.every((stage) => stage.status === "done")).toBe(true)

    const onDisk = unwrap(await readMeta(goalFolder))
    expect(onDisk.meta.complete).toBe(true)
  })

  test("reopening stage 2 demotes stage 3 and keeps exactly one active", async () => {
    unwrap(await applyTransition({ workspace, goalId, stageId: "stage-1", action: "done" }))
    unwrap(await applyTransition({ workspace, goalId, stageId: "stage-2", action: "done" }))
    const reopened = unwrap(
      await applyTransition({ workspace, goalId, stageId: "stage-2", action: "reopen" }),
    )
    expect(reopened.stages.map((stage) => stage.status)).toEqual(["done", "active", "pending"])
    expect(reopened.stages.filter((stage) => stage.status === "active")).toHaveLength(1)
  })

  test("the progress map never drifts from the statuses", async () => {
    for (const action of ["done", "done", "reopen", "done"] as const) {
      const outcome = unwrap(
        await applyTransition({
          workspace,
          goalId,
          stageId: action === "reopen" ? "stage-2" : "stage-1",
          action,
        }),
      )
      for (const stage of outcome.stages) {
        expect(outcome.progress[stage.id]).toBe(stage.status === "done")
      }
    }
  })
})

describe("the manager list", () => {
  test("counts match disk for three goals, with sort and search", async () => {
    const second = await makeGoal("read arm64", [goalId])
    const third = await makeGoal("write kernel modules", [goalId, second.goal.id])

    unwrap(await applyTransition({ workspace, goalId, stageId: "stage-1", action: "done" }))
    unwrap(await openChat({ workspace, goalId }))
    unwrap(await openChat({ workspace, goalId }))
    unwrap(
      await applyTransition({
        workspace,
        goalId: second.goal.id,
        stageId: "stage-1",
        action: "done",
        now: "2026-11-02T00:00:00.000Z",
      }),
    )

    const rows = await listGoals({ workspace })
    expect(rows).toHaveLength(3)
    const mine = rows.find((row) => row.id === goalId)!
    expect(mine.stageCount).toBe(3)
    expect(mine.stagesDone).toBe(1)
    expect(mine.chatCount).toBe(2)

    expect((await listGoals({ workspace, query: "disassembly" })).map((row) => row.id)).toEqual([goalId])
    expect((await listGoals({ workspace, query: "" })).length).toBe(3)
    expect((await listGoals({ workspace, query: "arm" })).map((row) => row.id)).toEqual([second.goal.id])

    const byProgress = await listGoals({ workspace, sort: "progress" })
    expect(byProgress[byProgress.length - 1]?.id).toBe(third.goal.id)
    const byName = await listGoals({ workspace, sort: "name" })
    expect(byName.map((row) => row.name)).toEqual([
      "read arm64",
      "read disassembly",
      "write kernel modules",
    ])
  })

  test("a corrupt meta.json is a broken row and the rest still list", async () => {
    const second = await makeGoal("read arm64", [goalId])
    await writeFile(join(second.folder, "meta.json"), "{ not json")

    const rows = await listGoals({ workspace })
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === second.goal.id)?.broken).toBe(true)
    expect(rows.find((row) => row.id === goalId)?.broken).toBe(false)
  })
})

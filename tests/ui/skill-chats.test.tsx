/** Every chat in a goal opens its own transcript. */
import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { renderApp } = await import("../helpers/render")
const { App } = await import("../../src/app/App")
const { createWorkspace } = await import("../../src/storage/workspace")
const { saveGoal, validateInput } = await import("../../src/services/skills/create")
const { openChat, appendTurn } = await import("../../src/services/skills/chats")
const { createChatController } = await import("../../src/app/chat-controller")

const budget = {
  key: () => "test",
  isOverridden: () => false,
  overrideOnce: () => {},
  check: () => ({ block: null, state: { spent: 0, limit: 0, period: "day" } as never }),
}

test("a second chat opens its own history", async () => {
  const base = await mkdtemp(join(tmpdir(), "skill-chats-"))
  const made = await createWorkspace(join(base, "ws"), { dataDir: join(base, "data") })
  if (!made.ok) throw new Error("workspace")
  const validated = validateInput({ statement: "learn cpp", level: "beginner", timeBudget: "4 weeks" })
  if (!validated.ok) throw new Error(validated.error.message)
  const saved = await saveGoal({
    workspace: made.value,
    input: validated.value,
    stages: [
      { title: "Registers", milestone: "explain a frame" },
      { title: "Control flow", milestone: "trace a loop" },
      { title: "Conventions", milestone: "read a prologue" },
    ],
    created: "2026-11-01T09:00:00Z",
  })
  if (!saved.ok) throw new Error(saved.error.message)
  const goalId = saved.value.goal.id

  const first = await openChat({ workspace: made.value, goalId })
  const second = await openChat({ workspace: made.value, goalId })
  if (!first.ok || !second.ok) throw new Error("chat")
  const at = "2026-11-01T10:00:00Z"
  await appendTurn({
    workspace: made.value,
    goalId,
    chatId: second.value.id,
    outcome: "done",
    record: { role: "user", content: "SECOND-CHAT-MARKER", at },
  })

  const ui = await renderApp({
    width: 140,
    height: 36,
    app: () => (
      <App
        workspace={made.value}
        initial={{ pane: "skills" } as never}
        createChat={(history) =>
          createChatController({
            service: { active: () => [], cancel() {}, async *send() {} } as never,
            budget,
            history,
            scope: "skills",
            config: () => ({ model: null, maxToolCalls: 8, maxTokens: 16000, chillHistoryLimit: 20 }),
          })
        }
      />
    ),
  })
  try {
    await ui.waitUntil(() => ui.frame().includes("learn cpp"))
    await ui.press("l")
    await ui.waitUntil(() => ui.frame().includes("SECOND-CHAT-MARKER"))
    // The chats column is selected; move to the second chat and open it.
    await ui.press("j")
    await ui.press("return")
    await ui.waitUntil(() => ui.frame().includes("SECOND-CHAT-MARKER"))

    const frame = ui.frame()
    expect(frame).toContain("SECOND-CHAT-MARKER")
    expect(frame.split("\n")[0]).toContain("learn cpp")
  } finally {
    await ui.dispose()
  }
}, 30_000)

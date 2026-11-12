/** WP-804 — saved work chats: list, reopen, rename, delete, broken rows. */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const { testRender } = await import("@opentui/solid")
const chats = await import("../../src/ui/work/chats")
type State = import("../../src/ui/work/chats").ChatsState
const { crimson } = await import("../../src/ui/theme")

const ROWS = [
  { id: "chat-1", title: "why is the build slow?", updatedAt: "2026-10-30", messages: 14, lastAgent: "Reviewer" },
  { id: "chat-2", title: "add pagination", updatedAt: "2026-11-01", messages: 4, lastAgent: "Builder" },
  { id: "chat-3", title: "corrupt", updatedAt: "2026-10-01", messages: 0, lastAgent: "—", broken: "line 3 is not JSON" },
]
const state = (overrides: Partial<State> = {}): State => ({ ...chats.initialChats(ROWS), ...overrides })

async function mount(width: number, height: number, value = state()) {
  const setup = await testRender(
    () => <chats.WorkChatsPane theme={crimson} width={width} height={height} focused state={value} />,
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

describe("list", () => {
  test("renders title, time, message count and last agent, newest first", async () => {
    const setup = await mount(120, 24)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("add pagination  2026-11-01  4 msg  Builder")
      expect(frame).toContain("why is the build slow?  2026-10-30  14 msg  Reviewer")
      // newest first: chat-2 precedes chat-1
      expect(frame.indexOf("add pagination")).toBeLessThan(frame.indexOf("why is the build slow?"))
      expect(frame).toContain("SAVED CHATS · 3")
    } finally {
      await setup.dispose()
    }
  })

  test("the title is the first user line, truncated with an ellipsis", () => {
    expect(chats.titleOf("  hello there  ")).toBe("hello there")
    expect(chats.titleOf("x".repeat(60))).toHaveLength(chats.TITLE_MAX)
    expect(chats.titleOf("x".repeat(60)).endsWith("…")).toBe(true)
  })

  test("a broken chat shows its reason and stays selectable", async () => {
    const setup = await mount(120, 24, state({ cursor: 2 }))
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("× broken: line 3 is not JSON")
      expect(chats.selected(state({ cursor: 2 }))?.id).toBe("chat-3")
    } finally {
      await setup.dispose()
    }
  })
})

describe("reopen", () => {
  test("reopening mounts the last 12 messages and e loads older ones", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `m${i}`,
    }))
    const view = chats.reopen(messages)
    expect(chats.reopenView(view).visible).toHaveLength(12)
    expect(chats.reopenView(view).hidden).toBe(18)
    const older = chats.loadOlder(view)
    expect(chats.reopenView(older).visible).toHaveLength(24)
    expect(chats.intentFor("e")).toBe("load")
  })

  test("opening continues the same chat id", () => {
    expect(chats.openSelected(state({ cursor: 0 }))).toEqual({ kind: "open", id: "chat-2" })
    expect(chats.openSelected(chats.initialChats([])).kind).toBe("refused")
  })
})

describe("rename", () => {
  test("renames via a title-only action; an empty title is refused", () => {
    const renaming = chats.beginRename(state())
    expect(renaming.renaming?.id).toBe("chat-2")
    expect(chats.typeRename(renaming, "   ").renaming?.draft).toBe("   ")
    const refused = chats.commitRename(chats.typeRename(renaming, "   "))
    expect(refused.kind).toBe("refused")
    if (refused.kind !== "refused") throw new Error("expected a refusal")
    expect(refused.reason).toContain("cannot be empty")

    const renamed = chats.commitRename(chats.typeRename(renaming, "add pagination v2"))
    expect(renamed).toEqual({ kind: "rename", id: "chat-2", title: "add pagination v2" })
  })

  test("a rename changes only the title record", () => {
    const after = chats.afterRename(state(), "chat-2", "renamed")
    const before = state().chats.find((chat) => chat.id === "chat-2")!
    const now = after.chats.find((chat) => chat.id === "chat-2")!
    expect(now.title).toBe("renamed")
    expect(now.messages).toBe(before.messages)
    expect(now.lastAgent).toBe(before.lastAgent)
    expect(now.updatedAt).toBe(before.updatedAt)
    expect(chats.intentFor("r")).toBe("rename")
  })

  test("Esc during rename keeps the old title", () => {
    const cancelled = chats.cancelRename(chats.typeRename(chats.beginRename(state()), "nope"))
    expect(cancelled.renaming).toBe(null)
    expect(cancelled.chats.find((chat) => chat.id === "chat-2")?.title).toBe("add pagination")
  })
})

describe("delete", () => {
  test("d then d deletes after a confirmation naming the chat", async () => {
    const armed = chats.armDelete(state({ cursor: 1 }))
    expect(armed.pendingDelete?.title).toBe("why is the build slow?")
    expect(chats.deleteCopy("why is the build slow?")).toContain("the project files are untouched")
    const setup = await mount(120, 24, armed)
    try {
      expect(lines(setup).join("\n")).toContain("delete “why is the build slow?”")
    } finally {
      await setup.dispose()
    }
    expect(chats.confirmDelete(armed)).toEqual({ kind: "delete", id: "chat-1" })
  })

  test("d then Esc changes nothing", () => {
    const cancelled = chats.cancelDelete(chats.armDelete(state()))
    expect(cancelled.pendingDelete).toBe(null)
    expect(chats.confirmDelete(cancelled).kind).toBe("refused")
    expect(cancelled.chats).toHaveLength(3)
  })

  test("deleting the last chat is allowed and leaves the empty copy", async () => {
    const last = chats.initialChats([ROWS[1]!])
    const after = chats.afterDelete(chats.armDelete(last), "chat-2")
    expect(after.chats).toHaveLength(0)
    const setup = await mount(100, 24, after)
    try {
      expect(lines(setup).join("\n")).toContain("no chats yet · n to start one")
    } finally {
      await setup.dispose()
    }
    expect(chats.startNew()).toEqual({ kind: "new" })
  })
})

describe("persistence and layout", () => {
  test("only a done turn appends; a cancelled turn writes nothing", () => {
    expect(chats.appendsOn("done")).toBe(true)
    expect(chats.appendsOn("cancelled")).toBe(false)
    expect(chats.appendsOn("error")).toBe(false)
  })

  test("80x24 truncates rows with an ellipsis and keeps the footer", async () => {
    const long = {
      ...ROWS[1]!,
      title: "a very long chat title that cannot possibly fit in eighty columns of terminal",
    }
    const setup = await mount(80, 24, chats.initialChats([long]))
    try {
      const out = lines(setup)
      expect(out.length).toBe(24)
      for (const line of out) expect(line.length).toBe(80)
      expect(out.join("\n")).toContain("…")
      expect(out.join("\n")).toContain("d delete")
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

  test("keys come from one table and the pane performs no IO", () => {
    expect(chats.intentFor("n")).toBe("new")
    expect(chats.intentFor("return")).toBe("open")
    expect(chats.intentFor("d")).toBe("delete")
    expect(chats.footerHints()).toContain("n new")

    const source = readFileSync(join(import.meta.dir, "../../src/ui/work/chats.tsx"), "utf8")
    expect(source).not.toMatch(/writeFile\(|readFileSync\(|rename\(|unlink\(/)
    expect(source).not.toContain("src/services")
  })
})

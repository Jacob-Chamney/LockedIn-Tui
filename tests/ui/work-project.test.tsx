/** WP-706 — Work chat rows and the change review overlay. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const { testRender } = await import("@opentui/solid")
const workChat = await import("../../src/ui/work/chat")
const changes = await import("../../src/ui/work/changes")
const { initialChat } = await import("../../src/ui/chat/model")
const { crimson } = await import("../../src/ui/theme")

type Write = import("../../src/services/work/diff").ProposedWrite


const hunk = (index: number, oldStart: number, newStart: number, lines: Array<["add" | "remove" | "context", string]>) => ({
  index,
  oldStart,
  oldCount: lines.length,
  newStart,
  newCount: lines.length,
  lines: lines.map(([kind, text]) => ({ kind, text, newline: true })),
  oldLines: lines.map(([, text]) => `${text}\n`),
  newLines: lines.map(([, text]) => `${text}\n`),
})

const WRITE: Write = {
  path: "src/a.ts",
  baseHash: "sha256:abc",
  newContent: "x",
  diff: "",
  kind: "update",
  stats: { added: 4, removed: 1 },
  hunks: [hunk(0, 1, 1, [["remove", "old"], ["add", "new"]]), hunk(1, 10, 10, [["context", "same"]]), hunk(2, 20, 20, [["add", "extra"]])],
}

async function mountWith(render: () => never, width: number, height: number) {
  const setup = await testRender(render, { width, height })
  await setup.flush()
  await (setup.renderer as unknown as { loop: (skip: boolean) => Promise<void> }).loop(true)
  return setup
}

const mountChat = (width: number, height: number, view = workChat.initialWorkChat, state = initialChat("friend", "m")) =>
  mountWith(
    () => (<workChat.WorkChatPane theme={crimson} width={width} height={height} focused state={state} view={view} />) as never,
    width,
    height,
  )

const mountReview = (width: number, height: number, state = changes.openReview(WRITE), write = WRITE) =>
  mountWith(
    () => (<changes.ReviewOverlay theme={crimson} width={width} height={height} write={write} state={state} cursor={0} />) as never,
    width,
    height,
  )

function lines(setup: { captureCharFrame: () => string }): string[] {
  const out = setup.captureCharFrame().split("\n")
  while (out.length > 0 && out[out.length - 1] === "") out.pop()
  return out
}

describe("project chat", () => {
  test("streaming shows one tool line per call and the stop line", async () => {
    const streaming = { ...initialChat("friend", "m"), status: "streaming" as const, streamed: "half" }
    const view = { tools: [{ name: "read_file", lines: 3 }, { name: "search_files" }], proposal: null }
    const setup = await mountChat(120, 30, view, streaming)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("read_file · 3 lines")
      expect(frame).toContain("search_files")
      expect(frame).toContain("Esc stop")
    } finally {
      await setup.dispose()
    }
    expect(workChat.toolLine({ name: "read_file", lines: 1 })).toBe("read_file · 1 line")
  })

  test("a proposed write appears as one transcript row naming the review key", async () => {
    const view = { tools: [], proposal: WRITE }
    const setup = await mountChat(120, 30, view)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("proposed write · src/a.ts (+4 −1)")
      expect(frame).toContain("press r to review")
    } finally {
      await setup.dispose()
    }
    expect(workChat.proposalRow(WRITE)).toBe("proposed write · src/a.ts (+4 −1)")
  })

  test("busy and write-opt-in-off render inline, never as a modal", async () => {
    const view = { tools: [], proposal: WRITE, busy: true, writeOptIn: false, budgetPaused: true }
    const setup = await mountChat(120, 30, view)
    try {
      const frame = lines(setup).join("\n")
      expect(frame).toContain("a reply is already streaming")
      expect(frame).toContain("approval is refused until you enable writes")
      expect(frame).toContain("budget paused")
    } finally {
      await setup.dispose()
    }
  })

  test("one composer implementation: the work chat imports the WP-204 pane", () => {
    const root = join(import.meta.dir, "../../src")
    const files = readdirSync(join(root, "ui/work")).map((name) => join(root, "ui/work", name))
    const composers = files.filter((file) => readFileSync(file, "utf8").includes("PLACEHOLDER"))
    expect(composers).toEqual([])
    expect(readFileSync(join(root, "ui/work/chat.tsx"), "utf8")).toContain('from "../chat"')
  })
})

describe("change review", () => {
  test("the header names the path and hunk count; every hunk starts selected", () => {
    const state = changes.openReview(WRITE)
    expect(changes.reviewHeader(WRITE)).toBe("src/a.ts · 3 hunks · +4 −1")
    expect(state.selected).toEqual([0, 1, 2])
  })

  test("␣ selects hunks 1 and 3 only", () => {
    let state = changes.openReview(WRITE)
    state = changes.toggleHunk(state, 1)
    expect(state.selected).toEqual([0, 2])
    expect(changes.decide(WRITE, state, "approve")).toEqual({ kind: "approve", hunks: [0, 2] })
    state = changes.toggleHunk(state, 0)
    expect(state.selected).toEqual([2])
  })

  test("A selects all, and Y names the file and hunk count", () => {
    const partial = changes.toggleHunk(changes.openReview(WRITE), 0)
    expect(changes.selectAll({ ...WRITE, hunks: WRITE.hunks.slice(0, 2) }).selected).toEqual([0, 1])
    expect(changes.applyCopy(WRITE, partial)).toBe("apply 2 hunks to src/a.ts? press y again to confirm")
    expect(changes.applyCopy(WRITE, { ...partial, selected: [1] })).toContain("apply 1 hunk to src/a.ts")
  })

  test("Y with nothing selected is refused", () => {
    const none = { ...changes.openReview(WRITE), selected: [] }
    const refused = changes.decide(WRITE, none, "approve")
    expect(refused.kind).toBe("refused")
    if (refused.kind !== "refused") throw new Error("expected a refusal")
    expect(refused.reason).toContain("select at least one hunk")
  })

  test("N rejects and Esc decides nothing", () => {
    expect(changes.decide(WRITE, changes.openReview(WRITE), "reject")).toEqual({ kind: "reject" })
    expect(changes.resultLine("reject", WRITE, 0)).toContain("nothing was written")
    const closed = changes.closeReview()
    expect(closed.open).toBe(false)
    expect(closed.selected).toEqual([])
  })

  test("a stale proposal reports the conflict and applies nothing", () => {
    const stale = changes.applyError(
      { kind: "conflict", path: "src/a.ts", reason: "base-hash", message: "changed" },
      WRITE,
    )
    expect(stale).toContain("changed since this proposal")
    expect(stale).toContain("nothing was applied")
    const off = changes.applyError({ kind: "blocked", path: "src/a.ts", reason: "opt-in-off", message: "" }, WRITE)
    expect(off).toContain("writes are off")
  })

  test("the overlay renders the diff and both layout widths without clipping", async () => {
    for (const [w, h] of [[80, 24], [200, 60]] as const) {
      const setup = await mountReview(w, h)
      try {
        const out = lines(setup)
        expect(out.length).toBe(h)
        for (const line of out) expect(line.length).toBe(w)
        expect(out.join("\n")).toContain("src/a.ts · 3 hunks")
        expect(out.join("\n")).toContain("@@ -1,2 +1,2 @@")
      } finally {
        await setup.dispose()
      }
    }
    expect(changes.sideBySide(WRITE, 200)).toBe(true)
    expect(changes.sideBySide(WRITE, 80)).toBe(false)
  })

  test("keys come from one table and no file is touched", () => {
    expect(changes.intentFor("tab")).toBe("toggle")
    expect(changes.intentFor("a", { shift: true })).toBe("all")
    expect(changes.intentFor("y")).toBe("apply")
    expect(changes.footerHints()).toContain("y apply")

    for (const name of ["chat.tsx", "changes.tsx"]) {
      const source = readFileSync(join(import.meta.dir, "../../src/ui/work", name), "utf8")
      expect(source).not.toMatch(/writeFile\(|rename\(|unlink\(|rmSync\(/)
      expect(source).not.toContain("src/services/work/writes")
    }
  })
})

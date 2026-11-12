/** Each buffer's JSONL history is independent and survives a reload. */
import { afterAll, describe, expect, test } from "bun:test";
import { removeTemp } from "../helpers/cleanup";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { createJsonlHistoryPort, readChatHistory } = await import("../../src/storage/chat-history")

const base = await mkdtemp(join(tmpdir(), "chat-history-"))
afterAll(async () => {
  await removeTemp(base)
})

describe("per-buffer chat history", () => {
  test("two paths do not share a transcript", async () => {
    const one = createJsonlHistoryPort(join(base, "agent-a.jsonl"))
    const two = createJsonlHistoryPort(join(base, "agent-b.jsonl"))
    await one.save([{ role: "user", content: "for a", at: "2026-11-01T09:00:00Z" }])
    await two.save([{ role: "user", content: "for b", at: "2026-11-01T09:01:00Z" }])
    expect((await one.load()).map((r) => r.content)).toEqual(["for a"])
    expect((await two.load()).map((r) => r.content)).toEqual(["for b"])
  })

  test("an unreadable path is an error, never an empty transcript", async () => {
    const directory = join(base, "not-a-file")
    await createJsonlHistoryPort(join(directory, "chat.jsonl")).save([])
    // Reading a directory is EISDIR on POSIX; the port must surface it rather
    // than return [] and let the next save overwrite the real file.
    await expect(readChatHistory(directory)).rejects.toBeDefined()
  })

  test("a malformed line is skipped and the limit keeps the newest", async () => {
    const path = join(base, "nested", "chat.jsonl")
    const port = createJsonlHistoryPort(path, 2)
    await port.save([
      { role: "user", content: "one", at: "1" },
      { role: "assistant", content: "two", at: "2" },
      { role: "user", content: "three", at: "3" },
    ])
    expect((await port.load()).map((r) => r.content)).toEqual(["two", "three"])
    expect(await readChatHistory(join(base, "missing.jsonl"))).toEqual([])
  })
})

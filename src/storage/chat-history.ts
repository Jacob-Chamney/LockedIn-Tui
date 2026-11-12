/**
 * One chat log per surface.
 *
 * Each buffer gets its own JSONL file, so an agent chat, a lock-in session, a
 * skill session and Chill never share a transcript. The format is the same
 * `{ role, content, at }` record the work/skill chat services already write.
 */
import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

export type ChatHistoryRecord = { role: "user" | "assistant"; content: string; at: string }

export type ChatHistoryPort = {
  load: () => Promise<ChatHistoryRecord[]>
  save: (records: ChatHistoryRecord[]) => Promise<void>
}

/** Read one JSONL chat log; a malformed line is skipped, never fatal. */
export async function readChatHistory(path: string): Promise<ChatHistoryRecord[]> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    // ENOENT means no history yet. EACCES/EIO must not look like an empty
    // transcript: the next save would overwrite the real one with only the
    // turns that are in memory.
    if ((error as { code?: string }).code === "ENOENT") return []
    throw error
  }
  const records: ChatHistoryRecord[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      const raw = JSON.parse(line) as Partial<ChatHistoryRecord>
      if (raw.role !== "user" && raw.role !== "assistant") continue
      if (typeof raw.content !== "string") continue
      records.push({
        role: raw.role,
        content: raw.content,
        at: typeof raw.at === "string" ? raw.at : "",
      })
    } catch {
      // A corrupt line is one lost turn, not a broken chat.
    }
  }
  return records
}

/** Write a JSONL chat log atomically, keeping at most `limit` records. */
export async function writeChatHistory(path: string, records: ChatHistoryRecord[], limit = 20): Promise<void> {
  const kept = limit <= 0 ? [] : records.slice(Math.max(0, records.length - limit))
  const body = kept.map((record) => JSON.stringify(record)).join("\n")
  // Dot-prefixed so a crash leaves a temp file that archives/export skip.
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${crypto.randomUUID()}`)
  try {
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(temporary, body.length > 0 ? `${body}\n` : "")
    const handle = await open(temporary, "r+")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export function createJsonlHistoryPort(path: string, limit = 20): ChatHistoryPort {
  return {
    load: () => readChatHistory(path),
    save: (records) => writeChatHistory(path, records, limit),
  }
}

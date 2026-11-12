/**
 * Small session-side learning files: parked questions, intake, contracts,
 * contradiction reports, attempt checks and a misconception ledger.
 *
 * These are Markdown/JSONL files inside the session folder; none of them is a
 * second source of truth for progress. Writes are atomic where a file is
 * replaced, append-only for ledgers.
 */
import { open, readFile, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { SESSION_FILES } from "../../domain/session"

async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${crypto.randomUUID()}`)
  try {
    await Bun.write(temporary, text)
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

async function readOr(path: string, fallback = ""): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return fallback
  }
}

export async function readSessionFile(folder: string, name: string): Promise<string> {
  return readOr(join(folder, name))
}

export async function writeSessionFile(folder: string, name: string, text: string): Promise<void> {
  await writeAtomic(join(folder, name), text)
}

export async function parkQuestion(folder: string, text: string, step?: string): Promise<number> {
  const path = join(folder, SESSION_FILES.questions)
  const existing = await readOr(path, "# Parked questions\n\n")
  const lines = [existing.trimEnd(), "", `- [ ] ${text.trim()}${step ? `\n  step: ${step}` : ""}`, ""]
  await writeAtomic(path, `${lines.join("\n")}`)
  return (existing.match(/^- \[ \]/gm) ?? []).length + 1
}

export async function questionCount(folder: string): Promise<number> {
  return ((await readOr(join(folder, SESSION_FILES.questions))).match(/^- \[ \]/gm) ?? []).length
}

export async function writeIntakeLevel(folder: string, level: "beginner" | "intermediate" | "advanced"): Promise<void> {
  await writeAtomic(
    join(folder, SESSION_FILES.intake),
    `# Starting level\n\n${level}\n\nUse this to calibrate step granularity and explanation depth.\n`,
  )
}

export async function appendMisconception(folder: string, text: string, step?: string): Promise<void> {
  const path = join(folder, SESSION_FILES.misconceptions)
  const existing = await readOr(path, "# Misconceptions\n\n")
  await writeAtomic(path, `${existing.trimEnd()}\n\n- ${text.trim()}${step ? `\n  step: ${step}` : ""}\n`)
}

export async function appendConfidence(folder: string, rating: number, step?: string): Promise<void> {
  const path = join(folder, SESSION_FILES.confidence)
  const record = JSON.stringify({ at: new Date().toISOString(), rating, step: step ?? null })
  const existing = await readOr(path)
  await writeAtomic(path, `${existing}${record}\n`)
}

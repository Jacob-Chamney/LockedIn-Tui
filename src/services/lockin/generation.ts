/**
 * Track which inputs produced `assignment-steps.md`, so an edited prompt,
 * added source or changed intake can be shown as stale instead of silently
 * leaving an old plan in place.
 */
import { open, readFile, rename } from "node:fs/promises"
import { join } from "node:path"

import { SESSION_FILES } from "../../domain/session"
import type { Workspace } from "../../storage/workspace"
import { openSession, sessionFolderFor } from "./manager"

export type StepsGenerationRecord = {
  schema: 1
  promptHash: string
  sourceHashes: string[]
  intakeHash: string
  contractHash: string
  generatedAt: string
}

function hashText(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex")
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return ""
  }
}

async function currentInputs(workspace: Workspace, id: string): Promise<StepsGenerationRecord | null> {
  const opened = await openSession({ workspace, id })
  if (!opened.ok) return null
  const { folder, session } = opened.value
  return {
    schema: 1,
    promptHash: hashText(await readText(join(folder, SESSION_FILES.prompt))),
    sourceHashes: session.sources.map((source) => source.hash).sort(),
    intakeHash: hashText(await readText(join(folder, SESSION_FILES.intake))),
    contractHash: hashText(await readText(join(folder, SESSION_FILES.contract))),
    generatedAt: "",
  }
}

export async function stampStepsGeneration(input: {
  workspace: Workspace
  id: string
  at?: string
}): Promise<void> {
  const current = await currentInputs(input.workspace, input.id)
  if (current === null) return
  const folder = sessionFolderFor(input.workspace, input.id)
  const record = { ...current, generatedAt: input.at ?? new Date().toISOString() }
  const target = join(folder, SESSION_FILES.generation)
  const temporary = join(folder, `.${SESSION_FILES.generation}.tmp-${crypto.randomUUID()}`)
  try {
    await Bun.write(temporary, `${JSON.stringify(record, null, 2)}\n`)
    const handle = await open(temporary, "r+")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
  } catch {
    // Metadata is a warning, never a reason to fail the generation.
  }
}

export async function stepsAreStale(workspace: Workspace, id: string): Promise<boolean> {
  const folder = sessionFolderFor(workspace, id)
  let raw: string
  try {
    raw = await readFile(join(folder, SESSION_FILES.generation), "utf8")
  } catch {
    return false
  }
  let recorded: StepsGenerationRecord
  try {
    recorded = JSON.parse(raw) as StepsGenerationRecord
  } catch {
    return false
  }
  const current = await currentInputs(workspace, id)
  if (current === null) return false
  return (
    recorded.promptHash !== current.promptHash ||
    recorded.intakeHash !== current.intakeHash ||
    recorded.contractHash !== current.contractHash ||
    recorded.sourceHashes.join("\n") !== current.sourceHashes.join("\n")
  )
}
